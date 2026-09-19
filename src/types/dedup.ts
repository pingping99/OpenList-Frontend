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
