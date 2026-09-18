/* Native subprocess operations are unavailable in the browser compiler. */
#include <stdio.h>
#include <errno.h>
#include <sys/types.h>
static int porfground_system(const char *s) {
  (void)s;
  errno = ENOSYS;
  return -1;
}
#define system porfground_system
static char *mkdtemp(char *s) {
  (void)s;
  errno = ENOSYS;
  return NULL;
}
static int mkstemp(char *s) {
  (void)s;
  errno = ENOSYS;
  return -1;
}
static FILE *popen(const char *s, const char *m) {
  (void)s;
  (void)m;
  errno = ENOSYS;
  return NULL;
}
static int pclose(FILE *f) {
  (void)f;
  errno = ENOSYS;
  return -1;
}
static pid_t fork(void) {
  errno = ENOSYS;
  return -1;
}
static int execvp(const char *s, char *const a[]) {
  (void)s;
  (void)a;
  errno = ENOSYS;
  return -1;
}
static pid_t waitpid(pid_t p, int *s, int o) {
  (void)p;
  (void)s;
  (void)o;
  errno = ENOSYS;
  return -1;
}
#define WIFEXITED(s) 0
#define WEXITSTATUS(s) 1
#define WIFSIGNALED(s) 0
#define WTERMSIG(s) 0
