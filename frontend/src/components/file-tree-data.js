export function updateFileTreeData(model, paths, gitStatus) {
  model.resetPaths(paths)
  model.setGitStatus(gitStatus)
}
