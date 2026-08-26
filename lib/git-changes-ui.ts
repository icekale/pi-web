import { getFileName, getRelativeFilePath } from "./file-paths";
import type { GitFileStatus, GitFileStatusKind } from "./git-types";

export const GIT_CHANGES_LIST_LIMIT = 200;

const STATUS_RANK: Record<GitFileStatusKind, number> = {
  conflict: 0,
  modified: 1,
  renamed: 1,
  added: 2,
  deleted: 3,
  untracked: 4,
};

export interface GitChangeRow {
  file: GitFileStatus;
  relativePath: string;
  fileName: string;
  directory: string;
  letter: GitFileStatus["code"];
  labelKey: `files.${GitFileStatusKind}`;
}

export function gitStatusLabelKey(status: GitFileStatusKind): GitChangeRow["labelKey"] {
  return `files.${status}`;
}

export function sortGitChangeFiles(files: readonly GitFileStatus[], cwd: string): GitFileStatus[] {
  return [...files].sort((left, right) => {
    const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];
    if (rank !== 0) return rank;
    return getRelativeFilePath(left.filePath, cwd).localeCompare(getRelativeFilePath(right.filePath, cwd));
  });
}

export function buildGitChangeRows(
  files: readonly GitFileStatus[],
  cwd: string,
  limit = GIT_CHANGES_LIST_LIMIT,
): { rows: GitChangeRow[]; omitted: number } {
  const sorted = sortGitChangeFiles(files, cwd);
  const omitted = Math.max(0, sorted.length - limit);
  const rows = sorted.slice(0, limit).map((file) => {
    const relativePath = getRelativeFilePath(file.filePath, cwd);
    const fileName = getFileName(file.filePath);
    const separator = relativePath.lastIndexOf("/");
    return {
      file,
      relativePath,
      fileName,
      directory: separator === -1 ? "" : relativePath.slice(0, separator),
      letter: file.code,
      labelKey: gitStatusLabelKey(file.status),
    };
  });
  return { rows, omitted };
}
