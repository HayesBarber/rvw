/**
 * @typedef {'modified' | 'added' | 'deleted' | 'unchanged'} FileStatus
 */

/**
 * @typedef {Object} FileSummary
 * @property {string} path Canonical repository-relative path.
 * @property {FileStatus} status
 * @property {number} additions
 * @property {number} deletions
 * @property {number} commentCount
 */

/**
 * @typedef {Object} ReviewOverview
 * @property {{ id: string, repository: { name: string }, source: { kind: 'working-tree', base: string } }} review
 * @property {string} initialPath
 * @property {FileSummary[]} files
 * @property {ReviewComment[]} comments
 */

/**
 * @typedef {Object} FileContents
 * @property {string} name
 * @property {string} contents
 * @property {string} [lang]
 */

/**
 * @typedef {{ kind: 'file', path: string } | { kind: 'line', path: string, side: 'old' | 'new', startLine: number, endLine: number }} CommentTarget
 */

/**
 * @typedef {Object} ReviewComment
 * @property {string} id
 * @property {string} body
 * @property {CommentTarget} target
 */

/**
 * @typedef {Object} FileReview
 * @property {string} path
 * @property {FileStatus} status
 * @property {{ kind: 'diff', oldFile: FileContents | null, newFile: FileContents | null } | { kind: 'file', file: FileContents }} content
 */

const REVIEW_ID = 'working-tree'

/** @type {ReviewOverview} */
const overview = {
  review: {
    id: REVIEW_ID,
    repository: { name: 'rvw' },
    source: { kind: 'working-tree', base: 'HEAD' },
  },
  initialPath: 'src/app/review.zig',
  files: [
    {
      path: 'README.md',
      status: 'unchanged',
      additions: 0,
      deletions: 0,
      commentCount: 0,
    },
    {
      path: 'src/app/review.zig',
      status: 'modified',
      additions: 6,
      deletions: 2,
      commentCount: 2,
    },
    {
      path: 'src/app/session.zig',
      status: 'added',
      additions: 9,
      deletions: 0,
      commentCount: 1,
    },
    {
      path: 'src/legacy.zig',
      status: 'deleted',
      additions: 0,
      deletions: 5,
      commentCount: 0,
    },
    {
      path: 'src/main.zig',
      status: 'unchanged',
      additions: 0,
      deletions: 0,
      commentCount: 1,
    },
  ],
  comments: [
    {
      id: 'comment-1',
      body: 'Should the review own this identifier, or should the platform layer provide it?',
      target: {
        kind: 'line',
        path: 'src/app/review.zig',
        side: 'new',
        startLine: 4,
        endLine: 4,
      },
    },
    {
      id: 'comment-2',
      body: 'The model boundary is taking shape. We should keep platform-specific data out of this struct.',
      target: { kind: 'file', path: 'src/app/review.zig' },
    },
    {
      id: 'comment-3',
      body: 'Consider representing the two commit endpoints separately instead of keeping a range string.',
      target: {
        kind: 'line',
        path: 'src/app/session.zig',
        side: 'new',
        startLine: 8,
        endLine: 8,
      },
    },
    {
      id: 'comment-4',
      body: 'This file is unchanged, but it may eventually need to initialize the selected review mode.',
      target: {
        kind: 'line',
        path: 'src/main.zig',
        side: 'new',
        startLine: 3,
        endLine: 5,
      },
    },
  ],
}

/** @type {Record<string, FileReview>} */
const fileReviews = {
  'README.md': {
    path: 'README.md',
    status: 'unchanged',
    content: {
      kind: 'file',
      file: {
        name: 'README.md',
        contents: `# rvw

An integrated environment for reviewing code with a native core and web UI.
`,
      },
    },
  },
  'src/app/review.zig': {
    path: 'src/app/review.zig',
    status: 'modified',
    content: {
      kind: 'diff',
      oldFile: {
        name: 'src/app/review.zig',
        contents: `const std = @import("std");

pub const Review = struct {
    files: []const []const u8,
};

pub fn open() void {
    std.debug.print("opening review\\n", .{});
}
`,
      },
      newFile: {
        name: 'src/app/review.zig',
        contents: `const std = @import("std");

pub const Review = struct {
    id: []const u8,
    files: []const File,
};

pub const File = struct {
    path: []const u8,
    status: Status,
};

pub fn open(review: Review) void {
    std.debug.print("opening {s}\\n", .{review.id});
}
`,
      },
    },
  },
  'src/app/session.zig': {
    path: 'src/app/session.zig',
    status: 'added',
    content: {
      kind: 'diff',
      oldFile: null,
      newFile: {
        name: 'src/app/session.zig',
        contents: `pub const Session = struct {
    repository_path: []const u8,
    comparison: Comparison,
};

pub const Comparison = union(enum) {
    working_tree,
    commit_range: []const u8,
};
`,
      },
    },
  },
  'src/legacy.zig': {
    path: 'src/legacy.zig',
    status: 'deleted',
    content: {
      kind: 'diff',
      oldFile: {
        name: 'src/legacy.zig',
        contents: `pub fn printFiles(files: []const []const u8) void {
    for (files) |file| {
        std.debug.print("{s}\\n", .{file});
    }
}
`,
      },
      newFile: null,
    },
  },
  'src/main.zig': {
    path: 'src/main.zig',
    status: 'unchanged',
    content: {
      kind: 'file',
      file: {
        name: 'src/main.zig',
        contents: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("rvw\\n", .{});
}
`,
      },
    },
  },
}

function copy(value) {
  return structuredClone(value)
}

/**
 * Loads metadata and file summaries for the active review.
 * @returns {Promise<ReviewOverview>}
 */
export async function getReviewOverview() {
  return copy(overview)
}

/**
 * Loads display content for one canonical file path.
 * @param {string} reviewId
 * @param {string} path
 * @returns {Promise<FileReview>}
 */
export async function getFileReview(reviewId, path) {
  if (reviewId !== REVIEW_ID) {
    throw new Error(`Unknown review: ${reviewId}`)
  }

  const review = fileReviews[path]
  if (!review) {
    throw new Error(`Unknown file: ${path}`)
  }

  return copy(review)
}
