#ifndef RVW_H
#define RVW_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct rvw_core rvw_core;

typedef struct rvw_buffer {
    uint8_t *ptr;
    size_t len;
} rvw_buffer;

/* Creates an independent, thread-safe core using the default review provider. */
rvw_core *rvw_core_create(void);

/*
 * Dispatches a length-delimited UTF-8 JSON request. Supported request types are
 * get_review_overview and get_file_review. Every non-empty result is a JSON
 * envelope containing either {"ok":true,"data":...} or
 * {"ok":false,"error":{"code":...,"message":...}}.
 */
rvw_buffer rvw_core_dispatch(rvw_core *core, const uint8_t *request, size_t request_len);

/* Response buffers must be freed before destroying their originating core. */
void rvw_buffer_free(rvw_core *core, rvw_buffer buffer);
void rvw_core_destroy(rvw_core *core);

#ifdef __cplusplus
}
#endif

#endif
