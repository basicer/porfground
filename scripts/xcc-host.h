#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <string.h>
static int porfground_tmp_counter;
static int porfground_mkstemps(char *name, int suffix) {
  char *p = name + strlen(name) - suffix - 6;
  unsigned n = ++porfground_tmp_counter;
  for (int i = 0; i < 6; i++) {
    p[i] = 'a' + n % 26;
    n /= 26;
  }
  return open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
}
static FILE *porfground_tmpfile(void) {
  char name[] = "/tmp/xcc-XXXXXX";
  int fd = porfground_mkstemps(name, 0);
  return fd < 0 ? NULL : fdopen(fd, "w+");
}
#define mkstemps porfground_mkstemps
#define tmpfile porfground_tmpfile
