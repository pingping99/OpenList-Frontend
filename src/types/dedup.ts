export interface DedupScanStats {
  scanned_dirs: number
  scanned_files: number
  verified_files: number
  unverified_files: number
  failed_dirs: number
  dup_groups: number
  dup_files: number
  wasted_bytes: number
  candidate_groups: number
  candidate_files: number
}

export interface DedupStatusResp {
  id: string
  task_id?: string
  root_path: string
  state: string
  status: string
  progress: number
  stats: DedupScanStats
  start_time?: string
  end_time?: string
  error?: string
}

export interface DedupFileItem {
  path: string
  name: string
  size: number
  hash_type: string
  hash: string
  modified: string
}

export interface DedupGroup {
  group_key: string
  hash_type: string
  hash: string
  size: number
  verified: boolean
  wasted_bytes: number
  files: DedupFileItem[]
}

export interface DedupResultResp {
  total: number
  page: number
  size: number
  groups: DedupGroup[]
}

export interface DedupTaskHistoryItem {
  id: string
  root_path: string
  state: string
  scanned_dirs: number
  scanned_files: number
  verified_files: number
  unverified_files: number
  failed_dirs: number
  dup_groups: number
  dup_files: number
  wasted_total: number
  candidate_groups: number
  candidate_files: number
  initial_dup_groups?: number
  initial_dup_files?: number
  initial_wasted?: number
  cleaned_files?: number
  cleaned_bytes?: number
  max_depth?: number
  concurrency?: number
  qps?: number
  min_size?: number
  include_exts?: string
  exclude_exts?: string
  started_at: string
  ended_at?: string
  error?: string
}

export interface DedupHistoryResp {
  content: DedupTaskHistoryItem[]
  total: number
}

export interface DedupRemoveResp {
  success_count: number
  failed_count: number
  companion_removed: number
  empty_dirs_removed: number
  rejected: { path: string; reason: string }[]
  errors: string[]
}

export interface DedupFolderMatchedFile {
  path_a: string
  path_b: string
  name_a: string
  name_b: string
  size: number
  group_key: string
}

export interface DedupFolderPair {
  dir_a: string
  dir_b: string
  total_files_a: number
  total_files_b: number
  total_size_a: number
  total_size_b: number
  dup_files_count: number
  dup_files_size: number
  ratio_a: number
  ratio_b: number
  similarity: number
  matched_files?: DedupFolderMatchedFile[]
}

export interface DedupFoldersResp {
  task_id: string
  threshold: number
  total: number
  folders: DedupFolderPair[]
}

export interface DedupMergeFoldersReq {
  task_id: string
  source_dir: string
  target_dir: string
  conflict_strategy?: "rename" | "skip" | "overwrite"
}

export interface DedupMergeFoldersResp {
  source_dir: string
  target_dir: string
  deleted_dup_files: number
  moved_unique_files: number
  reclaimed_bytes: number
  source_removed: boolean
  errors?: string[]
}
