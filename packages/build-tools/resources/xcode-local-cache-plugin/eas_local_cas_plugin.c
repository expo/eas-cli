#include <dlfcn.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Xcode loads one plugin that implements the llcas_* API. This small shim loads
 * Apple's local CAS plugin and forwards every API call to it. The only exception
 * is the "remote-service-path" option: Xcode needs that option to schedule C and
 * Objective-C cache tasks, but Apple's local plugin does not need a remote service.
 * The shim accepts and discards that option. No cache data leaves the machine.
 */

typedef void *llcas_cas_options_t;
typedef void *llcas_cas_t;
typedef void *llcas_cancellable_t;
typedef uint32_t llcas_lookup_result_t;

typedef struct {
  const uint8_t *data;
  size_t size;
} llcas_digest_t;

typedef struct {
  const void *data;
  size_t size;
} llcas_data_t;

typedef struct {
  uint64_t opaque;
} llcas_objectid_t;

typedef struct {
  uint64_t opaque;
} llcas_loaded_object_t;

typedef struct {
  uint64_t opaque_b;
  uint64_t opaque_e;
} llcas_object_refs_t;

typedef void (*llcas_cas_load_object_cb)(void *, llcas_lookup_result_t,
                                         llcas_loaded_object_t, char *);
typedef void (*llcas_actioncache_get_cb)(void *, llcas_lookup_result_t,
                                         llcas_objectid_t, char *);
typedef void (*llcas_actioncache_put_cb)(void *, bool, char *);

static void *apple_plugin_handle;

static void *apple_plugin_symbol(const char *name) {
  if (apple_plugin_handle == NULL) {
    const char *path = getenv("EAS_XCODE_LOCAL_CAS_APPLE_PLUGIN");
    if (path == NULL || path[0] == '\0') {
      path = "/Applications/Xcode.app/Contents/Developer/usr/lib/"
             "libToolchainCASPlugin.dylib";
    }
    apple_plugin_handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (apple_plugin_handle == NULL) {
      fprintf(stderr, "EAS local CAS plugin could not load %s: %s\n", path,
              dlerror());
      abort();
    }
  }

  void *symbol = dlsym(apple_plugin_handle, name);
  if (symbol == NULL) {
    fprintf(stderr, "EAS local CAS plugin could not find %s: %s\n", name,
            dlerror());
    abort();
  }
  return symbol;
}

#define APPLE_PLUGIN(name, type) ((type)apple_plugin_symbol(#name))

void llcas_get_plugin_version(uint32_t *major, uint32_t *minor) {
  typedef void (*fn_t)(uint32_t *, uint32_t *);
  APPLE_PLUGIN(llcas_get_plugin_version, fn_t)(major, minor);
}

void llcas_string_dispose(char *value) {
  typedef void (*fn_t)(char *);
  APPLE_PLUGIN(llcas_string_dispose, fn_t)(value);
}

void llcas_cancellable_cancel(llcas_cancellable_t token) {
  typedef void (*fn_t)(llcas_cancellable_t);
  APPLE_PLUGIN(llcas_cancellable_cancel, fn_t)(token);
}

void llcas_cancellable_dispose(llcas_cancellable_t token) {
  typedef void (*fn_t)(llcas_cancellable_t);
  APPLE_PLUGIN(llcas_cancellable_dispose, fn_t)(token);
}

llcas_cas_options_t llcas_cas_options_create(void) {
  typedef llcas_cas_options_t (*fn_t)(void);
  return APPLE_PLUGIN(llcas_cas_options_create, fn_t)();
}

void llcas_cas_options_dispose(llcas_cas_options_t options) {
  typedef void (*fn_t)(llcas_cas_options_t);
  APPLE_PLUGIN(llcas_cas_options_dispose, fn_t)(options);
}

void llcas_cas_options_set_client_version(llcas_cas_options_t options,
                                          uint32_t major, uint32_t minor) {
  typedef void (*fn_t)(llcas_cas_options_t, uint32_t, uint32_t);
  APPLE_PLUGIN(llcas_cas_options_set_client_version, fn_t)(options, major, minor);
}

void llcas_cas_options_set_ondisk_path(llcas_cas_options_t options,
                                       const char *path) {
  typedef void (*fn_t)(llcas_cas_options_t, const char *);
  APPLE_PLUGIN(llcas_cas_options_set_ondisk_path, fn_t)(options, path);
}

bool llcas_cas_options_set_option(llcas_cas_options_t options, const char *name,
                                  const char *value, char **error) {
  if (name != NULL && strcmp(name, "remote-service-path") == 0) {
    if (error != NULL) {
      *error = NULL;
    }
    return false;
  }
  typedef bool (*fn_t)(llcas_cas_options_t, const char *, const char *,
                       char **);
  return APPLE_PLUGIN(llcas_cas_options_set_option, fn_t)(options, name, value,
                                                          error);
}

llcas_cas_t llcas_cas_create(llcas_cas_options_t options, char **error) {
  typedef llcas_cas_t (*fn_t)(llcas_cas_options_t, char **);
  return APPLE_PLUGIN(llcas_cas_create, fn_t)(options, error);
}

void llcas_cas_dispose(llcas_cas_t cas) {
  typedef void (*fn_t)(llcas_cas_t);
  APPLE_PLUGIN(llcas_cas_dispose, fn_t)(cas);
}

int64_t llcas_cas_get_ondisk_size(llcas_cas_t cas, char **error) {
  typedef int64_t (*fn_t)(llcas_cas_t, char **);
  return APPLE_PLUGIN(llcas_cas_get_ondisk_size, fn_t)(cas, error);
}

bool llcas_cas_set_ondisk_size_limit(llcas_cas_t cas, int64_t size,
                                     char **error) {
  typedef bool (*fn_t)(llcas_cas_t, int64_t, char **);
  return APPLE_PLUGIN(llcas_cas_set_ondisk_size_limit, fn_t)(cas, size, error);
}

bool llcas_cas_prune_ondisk_data(llcas_cas_t cas, char **error) {
  typedef bool (*fn_t)(llcas_cas_t, char **);
  return APPLE_PLUGIN(llcas_cas_prune_ondisk_data, fn_t)(cas, error);
}

char *llcas_cas_get_hash_schema_name(llcas_cas_t cas) {
  typedef char *(*fn_t)(llcas_cas_t);
  return APPLE_PLUGIN(llcas_cas_get_hash_schema_name, fn_t)(cas);
}

uint32_t llcas_digest_parse(llcas_cas_t cas, const char *printed,
                            uint8_t *bytes, size_t bytes_size, char **error) {
  typedef uint32_t (*fn_t)(llcas_cas_t, const char *, uint8_t *, size_t,
                           char **);
  return APPLE_PLUGIN(llcas_digest_parse, fn_t)(cas, printed, bytes,
                                                bytes_size, error);
}

bool llcas_digest_print(llcas_cas_t cas, llcas_digest_t digest, char **printed,
                        char **error) {
  typedef bool (*fn_t)(llcas_cas_t, llcas_digest_t, char **, char **);
  return APPLE_PLUGIN(llcas_digest_print, fn_t)(cas, digest, printed, error);
}

bool llcas_cas_get_objectid(llcas_cas_t cas, llcas_digest_t digest,
                            llcas_objectid_t *object, char **error) {
  typedef bool (*fn_t)(llcas_cas_t, llcas_digest_t, llcas_objectid_t *,
                       char **);
  return APPLE_PLUGIN(llcas_cas_get_objectid, fn_t)(cas, digest, object, error);
}

llcas_digest_t llcas_objectid_get_digest(llcas_cas_t cas,
                                         llcas_objectid_t object) {
  typedef llcas_digest_t (*fn_t)(llcas_cas_t, llcas_objectid_t);
  return APPLE_PLUGIN(llcas_objectid_get_digest, fn_t)(cas, object);
}

llcas_lookup_result_t llcas_cas_contains_object(llcas_cas_t cas,
                                                llcas_objectid_t object,
                                                bool globally, char **error) {
  typedef llcas_lookup_result_t (*fn_t)(llcas_cas_t, llcas_objectid_t, bool,
                                        char **);
  return APPLE_PLUGIN(llcas_cas_contains_object, fn_t)(cas, object, globally,
                                                       error);
}

llcas_lookup_result_t llcas_cas_load_object(llcas_cas_t cas,
                                            llcas_objectid_t object,
                                            llcas_loaded_object_t *loaded,
                                            char **error) {
  typedef llcas_lookup_result_t (*fn_t)(llcas_cas_t, llcas_objectid_t,
                                        llcas_loaded_object_t *, char **);
  return APPLE_PLUGIN(llcas_cas_load_object, fn_t)(cas, object, loaded, error);
}

void llcas_cas_load_object_async(llcas_cas_t cas, llcas_objectid_t object,
                                 void *context,
                                 llcas_cas_load_object_cb callback,
                                 llcas_cancellable_t *cancellable) {
  typedef void (*fn_t)(llcas_cas_t, llcas_objectid_t, void *,
                       llcas_cas_load_object_cb, llcas_cancellable_t *);
  APPLE_PLUGIN(llcas_cas_load_object_async,
               fn_t)(cas, object, context, callback, cancellable);
}

bool llcas_cas_store_object(llcas_cas_t cas, llcas_data_t data,
                            const llcas_objectid_t *refs, size_t refs_count,
                            llcas_objectid_t *stored, char **error) {
  typedef bool (*fn_t)(llcas_cas_t, llcas_data_t, const llcas_objectid_t *,
                       size_t, llcas_objectid_t *, char **);
  return APPLE_PLUGIN(llcas_cas_store_object,
                      fn_t)(cas, data, refs, refs_count, stored, error);
}

llcas_data_t llcas_loaded_object_get_data(llcas_cas_t cas,
                                          llcas_loaded_object_t object) {
  typedef llcas_data_t (*fn_t)(llcas_cas_t, llcas_loaded_object_t);
  return APPLE_PLUGIN(llcas_loaded_object_get_data, fn_t)(cas, object);
}

llcas_object_refs_t llcas_loaded_object_get_refs(llcas_cas_t cas,
                                                 llcas_loaded_object_t object) {
  typedef llcas_object_refs_t (*fn_t)(llcas_cas_t, llcas_loaded_object_t);
  return APPLE_PLUGIN(llcas_loaded_object_get_refs, fn_t)(cas, object);
}

size_t llcas_object_refs_get_count(llcas_cas_t cas, llcas_object_refs_t refs) {
  typedef size_t (*fn_t)(llcas_cas_t, llcas_object_refs_t);
  return APPLE_PLUGIN(llcas_object_refs_get_count, fn_t)(cas, refs);
}

llcas_objectid_t llcas_object_refs_get_id(llcas_cas_t cas,
                                          llcas_object_refs_t refs,
                                          size_t index) {
  typedef llcas_objectid_t (*fn_t)(llcas_cas_t, llcas_object_refs_t, size_t);
  return APPLE_PLUGIN(llcas_object_refs_get_id, fn_t)(cas, refs, index);
}

llcas_lookup_result_t llcas_actioncache_get_for_digest(llcas_cas_t cas,
                                                       llcas_digest_t digest,
                                                       llcas_objectid_t *result,
                                                       bool globally,
                                                       char **error) {
  typedef llcas_lookup_result_t (*fn_t)(llcas_cas_t, llcas_digest_t,
                                        llcas_objectid_t *, bool, char **);
  return APPLE_PLUGIN(llcas_actioncache_get_for_digest,
                      fn_t)(cas, digest, result, globally, error);
}

void llcas_actioncache_get_for_digest_async(llcas_cas_t cas,
                                            llcas_digest_t digest,
                                            bool globally, void *context,
                                            llcas_actioncache_get_cb callback,
                                            llcas_cancellable_t *cancellable) {
  typedef void (*fn_t)(llcas_cas_t, llcas_digest_t, bool, void *,
                       llcas_actioncache_get_cb, llcas_cancellable_t *);
  APPLE_PLUGIN(llcas_actioncache_get_for_digest_async,
               fn_t)(cas, digest, globally, context, callback, cancellable);
}

bool llcas_actioncache_put_for_digest(llcas_cas_t cas, llcas_digest_t digest,
                                      llcas_objectid_t value, bool globally,
                                      char **error) {
  typedef bool (*fn_t)(llcas_cas_t, llcas_digest_t, llcas_objectid_t, bool,
                       char **);
  return APPLE_PLUGIN(llcas_actioncache_put_for_digest,
                      fn_t)(cas, digest, value, globally, error);
}

void llcas_actioncache_put_for_digest_async(llcas_cas_t cas,
                                            llcas_digest_t digest,
                                            llcas_objectid_t value,
                                            bool globally, void *context,
                                            llcas_actioncache_put_cb callback,
                                            llcas_cancellable_t *cancellable) {
  typedef void (*fn_t)(llcas_cas_t, llcas_digest_t, llcas_objectid_t, bool,
                       void *, llcas_actioncache_put_cb, llcas_cancellable_t *);
  APPLE_PLUGIN(llcas_actioncache_put_for_digest_async,
               fn_t)(cas, digest, value, globally, context, callback,
                     cancellable);
}
