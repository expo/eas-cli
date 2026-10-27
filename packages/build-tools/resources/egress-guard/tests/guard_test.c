// White-box host tests of guard.c's dedupe lock: the schedules that would
// abort the process are forced deterministically. Every case runs in its own
// process; sockets are never opened (fd -1), so nothing can leave the host.
// Build and run with tests/run-guard-tests.sh.
#include "../policy.h"

#include <pthread.h>
#include <signal.h>
#include <sys/wait.h>

static int scheduled_seen_insert(eg_seen_t *seen, const char *key);
#define eg_seen_insert scheduled_seen_insert
#include "../guard.c"
#undef eg_seen_insert

#include <arpa/inet.h>

#define CONTENTION_THREADS 8
#define CONTENTION_KEYS 12
#define CONTENTION_ROUNDS 25

static int interrupt_insert;
static int ready_pipe[2];
static int release_pipe[2];

static struct sockaddr_in remote(int port) {
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_len = sizeof a;
  a.sin_port = htons(port);
  inet_pton(AF_INET, "192.0.2.1", &a.sin_addr);
  return a;
}

// Block mode must refuse before touching the kernel, even on an invalid fd.
static void send_remote(int port) {
  struct sockaddr_in to = remote(port);
  if (eg_sendto(-1, "x", 1, 0, (struct sockaddr *)&to, sizeof to) != -1 || errno != ECONNREFUSED) {
    _exit(2);
  }
}

static void on_signal(int sig) {
  (void)sig;
  send_remote(9);
}

static int scheduled_seen_insert(eg_seen_t *seen, const char *key) {
  if (interrupt_insert) {
    interrupt_insert = 0;
    raise(SIGUSR1);
  }
  return eg_seen_insert(seen, key);
}

static int signal_reentry(void) {
  signal(SIGUSR1, on_signal);
  interrupt_insert = 1;
  send_remote(9);
  send_remote(10);
  return 0;
}

static void *hold_lock(void *unused) {
  (void)unused;
  char byte = 'x';
  os_unfair_lock_lock(&eg_lock);
  (void)write(ready_pipe[1], &byte, 1);
  (void)read(release_pipe[0], &byte, 1);
  os_unfair_lock_unlock(&eg_lock);
  return NULL;
}

static int fork_while_locked(void) {
  if (pipe(ready_pipe) || pipe(release_pipe)) {
    return 2;
  }
  pthread_t thread;
  if (pthread_create(&thread, NULL, hold_lock, NULL)) {
    return 2;
  }
  char byte;
  if (read(ready_pipe[0], &byte, 1) != 1) {
    return 2;
  }
  pid_t child = fork();
  if (child < 0) {
    return 2;
  }
  if (child == 0) {
    alarm(5);
    send_remote(9);
    send_remote(10);
    _exit(0);
  }
  (void)write(release_pipe[1], "x", 1);
  pthread_join(thread, NULL);
  int status;
  waitpid(child, &status, 0);
  if (WIFSIGNALED(status)) {
    printf("FAIL fork: child terminated by signal %d\n", WTERMSIG(status));
    return 1;
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 2;
}

static void *hammer(void *unused) {
  (void)unused;
  for (int round = 0; round < CONTENTION_ROUNDS; round++) {
    for (int key = 0; key < CONTENTION_KEYS; key++) {
      send_remote(1000 + key);
    }
  }
  return NULL;
}

// Under contention a thread may give up its insert; the next attempt on the
// same key must then record it, so every key ends up logged exactly once.
static int contention(const char *log_path) {
  pthread_t threads[CONTENTION_THREADS];
  for (int i = 0; i < CONTENTION_THREADS; i++) {
    if (pthread_create(&threads[i], NULL, hammer, NULL)) {
      return 2;
    }
  }
  for (int i = 0; i < CONTENTION_THREADS; i++) {
    pthread_join(threads[i], NULL);
  }
  FILE *log = fopen(log_path, "r");
  if (log == NULL) {
    return 2;
  }
  int counts[CONTENTION_KEYS] = {0};
  int total = 0;
  char line[1024];
  while (fgets(line, sizeof line, log)) {
    total++;
    for (int key = 0; key < CONTENTION_KEYS; key++) {
      char needle[64];
      snprintf(needle, sizeof needle, "\tsendto\tblocked\t192.0.2.1:%d\t", 1000 + key);
      if (strstr(line, needle)) {
        counts[key]++;
      }
    }
  }
  fclose(log);
  int failures = 0;
  for (int key = 0; key < CONTENTION_KEYS; key++) {
    if (counts[key] != 1) {
      printf("FAIL contention: 192.0.2.1:%d logged %d times\n", 1000 + key, counts[key]);
      failures++;
    }
  }
  if (total != CONTENTION_KEYS) {
    printf("FAIL contention: %d lines for %d keys\n", total, CONTENTION_KEYS);
    failures++;
  }
  return failures ? 1 : 0;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    return 2;
  }
  eg_mode = EG_MODE_BLOCK;
  if (strcmp(argv[1], "signal") == 0) {
    return signal_reentry();
  }
  if (strcmp(argv[1], "fork") == 0) {
    return fork_while_locked();
  }
  if (strcmp(argv[1], "contention") == 0) {
    return contention(eg_log_path);
  }
  return 2;
}
