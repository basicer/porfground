/* Porffor reserves anonymous arenas; WASI has no virtual memory protections.
   Its __wasi__ path never decommits. Ignore MAP_NORESERVE, which wasi-libc's
   mmap emulation rejects, and back these arenas with zeroed linear memory. */
#include <stdlib.h>
#include <errno.h>
#include <sys/types.h>
#include <stddef.h>
void *mmap(void *hint, size_t size, int prot, int flags, int fd, off_t offset) {
  (void)hint;
  (void)prot;
  (void)flags;
  if (fd != -1 || offset != 0) {
    errno = ENOTSUP;
    return (void *)-1;
  }
  void *p = calloc(1, size);
  return p ? p : (void *)-1;
}
int munmap(void *p, size_t size) {
  (void)size;
  free(p);
  return 0;
}
int mprotect(void *p, size_t size, int prot) {
  (void)p;
  (void)size;
  (void)prot;
  return 0;
}
