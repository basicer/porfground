import { put, type Files } from './wasi.ts';
// Porffor's WASI path needs mmap emulation; xcc ships a deliberately small libc.
const headers: Record<string, string> = {
  'signal.h':
    '#pragma once\n#define SIGPIPE 13\n#define SIG_IGN ((void (*)(int))1)\nstatic void (*signal(int s, void (*f)(int)))(int) { return f; }\nstatic _Noreturn void abort(void) { exit(134); }\nstatic double trunc(double x) { return x < 0 ? ceil(x) : floor(x); }\n#define CLOCK_MONOTONIC 1\n',
  'dirent.h': '#pragma once\n',
  'sys/mman.h': `#pragma once
#include <stdlib.h>
#include <stdint.h>
#define isnormal(x) ((x) == (x) && (x) != INFINITY && (x) != -INFINITY && fabs(x) >= 2.2250738585072014e-308)
#define PROT_NONE 0
#define PROT_READ 1
#define PROT_WRITE 2
#define MAP_PRIVATE 2
#define MAP_ANONYMOUS 32
#define MAP_NORESERVE 0
#define MAP_FAILED ((void*)-1)
static void *mmap(void *p, size_t n, int prot, int flags, int fd, long offset) { void *m = calloc(1,n); return m ? m : MAP_FAILED; }
static int mprotect(void *p, size_t n, int prot) { return 0; }
static int munmap(void *p, size_t n) { free(p); return 0; }
`,
};
export function addXccCompatibility(files: Files) {
  for (const [name, text] of Object.entries(headers))
    put(files, `usr/include/${name}`, new TextEncoder().encode(text));
}
// xcc emits some unreferenced inline helpers after discarding their static data.
// Give only column-zero runtime declarations external linkage in this single TU.
// Function-local static state remains static.
export function prepareC(source: string) {
  return source.replace(/^static (?:inline )?/gm, '');
}
