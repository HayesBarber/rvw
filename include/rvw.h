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

/*
 * Creates an independent, thread-safe Git diff snapshot. `directory` must
 * identify a Git worktree root. `range` is either NULL for a working-tree
 * diff or a two-commit expression such as "main..feature". On failure,
 * `error_out` receives UTF-8 text that may be freed with rvw_buffer_free(NULL,
 * ...).
 */
rvw_core *rvw_core_create(const char *directory, const char *range, rvw_buffer *error_out);

/*
 * Dispatches a length-delimited UTF-8 JSON request. Supported request types are
 * get_diff_overview and get_file_diff. Every non-empty result is a JSON
 * envelope containing either {"ok":true,"data":...} or
 * {"ok":false,"error":{"code":...,"message":...}}.
 */
rvw_buffer rvw_core_dispatch(rvw_core *core, const uint8_t *request, size_t request_len);

/* Response and creation-error buffers must be freed after use; `core` may be NULL. */
void rvw_buffer_free(rvw_core *core, rvw_buffer buffer);
void rvw_core_destroy(rvw_core *core);

#ifdef __cplusplus
}
#endif

#endif
