#include "policy.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int is_v4_local(uint32_t host_order) {
  return (host_order >> 24) == 127 || host_order == 0;
}

eg_class_t eg_classify(const struct sockaddr *sa, socklen_t len) {
  if (sa == NULL || len < 2) {
    return EG_PASSTHROUGH;
  }
  if (sa->sa_family == AF_INET) {
    if (len < sizeof(struct sockaddr_in)) {
      return EG_PASSTHROUGH;
    }
    const struct sockaddr_in *in = (const struct sockaddr_in *)sa;
    return is_v4_local(ntohl(in->sin_addr.s_addr)) ? EG_LOOPBACK : EG_REMOTE;
  }
  if (sa->sa_family == AF_INET6) {
    if (len < sizeof(struct sockaddr_in6)) {
      return EG_PASSTHROUGH;
    }
    const struct in6_addr *a6 = &((const struct sockaddr_in6 *)sa)->sin6_addr;
    if (IN6_IS_ADDR_LOOPBACK(a6) || IN6_IS_ADDR_UNSPECIFIED(a6)) {
      return EG_LOOPBACK;
    }
    if (IN6_IS_ADDR_V4MAPPED(a6)) {
      uint32_t v4;
      memcpy(&v4, &a6->s6_addr[12], sizeof v4);
      return is_v4_local(ntohl(v4)) ? EG_LOOPBACK : EG_REMOTE;
    }
    return EG_REMOTE;
  }
  return EG_PASSTHROUGH;
}

eg_mode_t eg_parse_mode(const char *value) {
  if (value != NULL && strcmp(value, "log") == 0) {
    return EG_MODE_LOG;
  }
  return EG_MODE_BLOCK;
}

int eg_should_deny(eg_mode_t mode, eg_class_t cls) {
  return mode == EG_MODE_BLOCK && cls == EG_REMOTE;
}

int eg_format_peer(const struct sockaddr *sa, socklen_t len, char *out, size_t n) {
  char ip[INET6_ADDRSTRLEN];
  int written;
  if (sa == NULL) {
    return -1;
  }
  if (sa->sa_family == AF_INET && len >= sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *in = (const struct sockaddr_in *)sa;
    if (inet_ntop(AF_INET, &in->sin_addr, ip, sizeof ip) == NULL) {
      return -1;
    }
    written = snprintf(out, n, "%s:%d", ip, ntohs(in->sin_port));
  } else if (sa->sa_family == AF_INET6 && len >= sizeof(struct sockaddr_in6)) {
    const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)sa;
    if (inet_ntop(AF_INET6, &in6->sin6_addr, ip, sizeof ip) == NULL) {
      return -1;
    }
    written = snprintf(out, n, "[%s]:%d", ip, ntohs(in6->sin6_port));
  } else {
    return -1;
  }
  return (written < 0 || (size_t)written >= n) ? -1 : 0;
}

int eg_seen_insert(eg_seen_t *seen, const char *key) {
  for (int i = 0; i < seen->count; i++) {
    if (strncmp(seen->keys[i], key, EG_SEEN_KEY_LENGTH - 1) == 0) {
      return 0;
    }
  }
  if (seen->count >= EG_SEEN_CAPACITY) {
    seen->overflow++;
    return 0;
  }
  strncpy(seen->keys[seen->count], key, EG_SEEN_KEY_LENGTH - 1);
  seen->keys[seen->count][EG_SEEN_KEY_LENGTH - 1] = '\0';
  seen->count++;
  return 1;
}

// Append `text` to out[*pos], replacing field separators; returns 0 when it fit.
static int append_field(char *out, size_t n, size_t *pos, const char *text) {
  for (const char *c = text; *c; c++) {
    if (*pos + 1 >= n) {
      return -1;
    }
    out[(*pos)++] = (*c == '\t' || *c == '\n' || *c == '\r') ? ' ' : *c;
  }
  return 0;
}

static int append_raw(char *out, size_t n, size_t *pos, const char *text) {
  size_t len = strlen(text);
  if (*pos + len + 1 > n) {
    return -1;
  }
  memcpy(out + *pos, text, len);
  *pos += len;
  return 0;
}

int eg_format_event(char *out, size_t n, const char *progname, int pid, const char *function,
                    const char *action, const char *peer, const char *const *callers,
                    int caller_count) {
  size_t pos = 0;
  char pid_text[16];
  snprintf(pid_text, sizeof pid_text, "%d", pid);
  if (append_raw(out, n, &pos, EG_EVENT_PREFIX "\t") != 0 ||
      append_field(out, n, &pos, progname ? progname : "?") != 0 ||
      append_raw(out, n, &pos, "\t") != 0 || append_raw(out, n, &pos, pid_text) != 0 ||
      append_raw(out, n, &pos, "\t") != 0 || append_field(out, n, &pos, function) != 0 ||
      append_raw(out, n, &pos, "\t") != 0 || append_field(out, n, &pos, action) != 0 ||
      append_raw(out, n, &pos, "\t") != 0 || append_field(out, n, &pos, peer) != 0 ||
      append_raw(out, n, &pos, "\t") != 0) {
    return -1;
  }
  for (int i = 0; i < caller_count && callers != NULL; i++) {
    if (i > 0 && append_raw(out, n, &pos, ",") != 0) {
      return -1;
    }
    // Commas separate callers, so they cannot appear inside one.
    for (const char *c = callers[i]; *c; c++) {
      char ch = (*c == ',' || *c == '\t' || *c == '\n' || *c == '\r') ? ' ' : *c;
      if (pos + 1 >= n) {
        return -1;
      }
      out[pos++] = ch;
    }
  }
  if (append_raw(out, n, &pos, "\n") != 0) {
    return -1;
  }
  out[pos] = '\0';
  return (int)pos;
}
