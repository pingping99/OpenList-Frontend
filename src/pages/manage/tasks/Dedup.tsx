import {
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  HStack,
  VStack,
  Input,
  Text,
  Badge,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  ProgressIndicator,
  Spacer,
  Tag,
  Spinner,
  FormControl,
  FormLabel,
  FormHelperText,
} from "@hope-ui/solid"
import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { Paginator } from "~/components"
import { FolderChooseInput } from "~/components/FolderTree"
import { useFetch, useManageTitle, useT } from "~/hooks"
import {
  DedupGroup,
  DedupFileItem,
  DedupTaskHistoryItem,
  DedupStatusResp,
  DedupRemoveResp,
  DedupFolderPair,
  DedupFolderMatchedFile,
  DedupMergeFoldersResp,
} from "~/types"
import { formatDate, getFileSize, handleResp, notify } from "~/utils"
import {
  dedupStart,
  dedupStatus,
  dedupCancel,
  dedupResult,
  dedupRemove,
  dedupHistory,
  dedupDeleteHistory,
  dedupClearEmptyHistory,
  dedupFolders,
  dedupMergeFolders,
} from "~/utils/api"
import { BsSearch, BsArrowRepeat } from "solid-icons/bs"

const RUNNING_STATES = ["queued", "running", "canceling"]

const stateI18nKey = (state: string) => {
  const known = [
    "queued",
    "running",
    "canceling",
    "canceled",
    "finished",
    "failed",
    "errored",
    "interrupted",
  ]
  return `dedup.state.${known.includes(state) ? state : "unknown"}`
}

const stateColor = (
  state: string,
): "info" | "success" | "danger" | "warning" | "neutral" => {
  switch (state) {
    case "finished":
      return "success"
    case "running":
    case "queued":
    case "canceling":
      return "info"
    case "failed":
    case "errored":
      return "danger"
    case "canceled":
    case "interrupted":
      return "warning"
    default:
      return "neutral"
  }
}

const getCategory = (filename: string) => {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  if (
    ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "rmvb", "m4v"].includes(
      ext,
    )
  ) {
    return { key: "video", label: "🎬 视频", color: "info" as const }
  }
  if (
    ["zip", "rar", "7z", "tar", "gz", "iso", "bz2", "tgz", "xz"].includes(ext)
  ) {
    return { key: "archive", label: "📦 压缩包", color: "accent" as const }
  }
  if (
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "raw", "ico"].includes(
      ext,
    )
  ) {
    return { key: "image", label: "🖼️ 图片", color: "success" as const }
  }
  if (["mp3", "flac", "wav", "aac", "ogg", "m4a", "wma"].includes(ext)) {
    return { key: "audio", label: "🎵 音频", color: "warning" as const }
  }
  if (
    ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md"].includes(
      ext,
    )
  ) {
    return { key: "doc", label: "📄 文档", color: "neutral" as const }
  }
  return { key: "other", label: "📁 其他", color: "neutral" as const }
}

const sortGroupFiles = (group: DedupGroup): DedupFileItem[] => {
  return [...group.files].sort((a, b) => {
    const timeA = new Date(a.modified).getTime() || 0
    const timeB = new Date(b.modified).getTime() || 0
    if (timeA === timeB) {
      return a.path.localeCompare(b.path)
    }
    return timeA - timeB
  })
}

const getOriginalPath = (group: DedupGroup): string => {
  const sorted = sortGroupFiles(group)
  return sorted.length > 0 ? sorted[0].path : ""
}

const sortGroupFilesByPathLength = (group: DedupGroup): DedupFileItem[] => {
  return [...group.files].sort((a, b) => {
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length
    }
    const depthA = a.path.split("/").length
    const depthB = b.path.split("/").length
    if (depthA !== depthB) {
      return depthA - depthB
    }
    const timeA = new Date(a.modified).getTime() || 0
    const timeB = new Date(b.modified).getTime() || 0
    if (timeA !== timeB) {
      return timeA - timeB
    }
    return a.path.localeCompare(b.path)
  })
}

const getCopiesToClean = (
  group: DedupGroup,
  mode: "oldest" | "newest" | "shortest" | "longest",
): string[] => {
  if (group.files.length < 2) return []
  if (mode === "oldest" || mode === "newest") {
    const sorted = sortGroupFiles(group)
    const keep = mode === "newest" ? sorted[sorted.length - 1] : sorted[0]
    return sorted.filter((f) => f.path !== keep.path).map((f) => f.path)
  }
  if (mode === "shortest" || mode === "longest") {
    const sorted = sortGroupFilesByPathLength(group)
    const keep = mode === "longest" ? sorted[sorted.length - 1] : sorted[0]
    return sorted.filter((f) => f.path !== keep.path).map((f) => f.path)
  }
  return []
}

const calcGroupWasted = (
  group: DedupGroup,
  selectedPaths: string[],
): number => {
  const selectedCount = group.files.filter((f) =>
    selectedPaths.includes(f.path),
  ).length
  if (selectedCount === 0) return 0
  if (group.files.length - selectedCount >= 1) {
    return group.size * selectedCount
  }
  return group.size * Math.max(selectedCount - 1, 0)
}
const toTimeNumber = (n: number) => {
  return Math.floor(n).toString().padStart(2, "0")
}

const getTimeStr = (millisecond: number) => {
  if (millisecond <= 0 || isNaN(millisecond)) return "00:00:00"
  const sec = Math.floor((millisecond / 1000) % 60)
  const min = Math.floor((millisecond / 1000 / 60) % 60)
  const hour = Math.floor(millisecond / 1000 / 3600)
  return `${toTimeNumber(hour)}:${toTimeNumber(min)}:${toTimeNumber(sec)}`
}

export const TaskProgressBar: Component<{
  progress?: number
  isIndeterminate?: boolean
  startTime?: string
  statusText?: string
}> = (props) => {
  const [elapsed, setElapsed] = createSignal("00:00:00")

  createEffect(() => {
    if (!props.startTime) return
    const startMs = new Date(props.startTime).getTime()
    if (isNaN(startMs)) return
    const update = () => {
      const diff = Date.now() - startMs
      setElapsed(getTimeStr(diff))
    }
    update()
    const timer = setInterval(update, 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <VStack w="$full" spacing="$1_5" alignItems="stretch">
      <HStack
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
      >
        <Text fontSize="$xs" color="$neutral11" fontWeight="$medium">
          {props.statusText || "扫描进度"}
        </Text>
        <HStack spacing="$2" alignItems="center">
          <Show when={props.startTime}>
            <Text fontSize="$xs" color="$neutral10">
              耗时: {elapsed()}
            </Text>
          </Show>
          <Show
            when={
              props.progress !== undefined &&
              props.progress > 0 &&
              !props.isIndeterminate
            }
          >
            <Badge colorScheme="info" fontSize="$xs">
              {Math.round(props.progress!)}%
            </Badge>
          </Show>
        </HStack>
      </HStack>
      <Progress
        w="$full"
        trackColor="$info3"
        rounded="$full"
        size="sm"
        value={props.progress ?? 0}
        indeterminate={props.isIndeterminate}
      >
        <ProgressIndicator color="$info8" rounded="$full" />
      </Progress>
    </VStack>
  )
}

// ==================== CleanModal 组件 ====================

interface CleanModalProps {
  opened: boolean
  onClose: () => void
  taskId: string
  paths: string[]
  reclaimSize: number
  onDone: () => void
}

const CleanModal: Component<CleanModalProps> = (props) => {
  const t = useT()
  const [deleteCompanions, setDeleteCompanions] = createSignal(true)
  const [removeEmptyDirs, setRemoveEmptyDirs] = createSignal(false)
  const [result, setResult] = createSignal<DedupRemoveResp>()
  const [cleaning, doRemove] = useFetch(dedupRemove)

  createEffect(() => {
    if (props.opened) {
      setResult(undefined)
    }
  })

  const handleClean = async () => {
    const res = await doRemove(
      props.taskId,
      props.paths,
      deleteCompanions(),
      removeEmptyDirs(),
    )
    handleResp(
      res,
      (data) => {
        setResult(data)
        props.onDone()
        if (data.failed_count === 0 && data.rejected.length === 0) {
          notify.success(
            t("dedup.clean.success", { count: data.success_count }),
          )
        } else {
          notify.warning(
            t("dedup.clean.partial", {
              success: data.success_count,
              failed: data.failed_count + data.rejected.length,
            }),
          )
        }
      },
      (err) => notify.error(err),
    )
  }

  return (
    <Modal
      blockScrollOnMount={false}
      opened={props.opened}
      onClose={props.onClose}
      size={{ "@initial": "xs", "@md": "lg" }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalCloseButton />
        <ModalHeader>{t("dedup.clean.title")}</ModalHeader>
        <ModalBody>
          <Show
            when={!result()}
            fallback={
              <VStack alignItems="stretch" spacing="$2">
                <Text fontSize="$sm">
                  {t("dedup.clean.report", {
                    success: result()!.success_count,
                    failed: result()!.failed_count + result()!.rejected.length,
                  })}
                </Text>
                <Show when={result()!.companion_removed > 0}>
                  <Text fontSize="$sm" color="$neutral10">
                    {t("dedup.clean.companion_removed", {
                      count: result()!.companion_removed,
                    })}
                  </Text>
                </Show>
                <Show when={result()!.empty_dirs_removed > 0}>
                  <Text fontSize="$sm" color="$neutral10">
                    {t("dedup.clean.empty_dirs_removed", {
                      count: result()!.empty_dirs_removed,
                    })}
                  </Text>
                </Show>
                <Show when={result()!.rejected.length > 0}>
                  <Box
                    p="$2"
                    rounded="$md"
                    bgColor="$warning3"
                    maxH="200px"
                    overflowY="auto"
                  >
                    <For each={result()!.rejected}>
                      {(item) => (
                        <Text fontSize="$xs" css={{ wordBreak: "break-all" }}>
                          {item.path} — {item.reason}
                        </Text>
                      )}
                    </For>
                  </Box>
                </Show>
                <Show when={result()!.errors.length > 0}>
                  <Box
                    p="$2"
                    rounded="$md"
                    bgColor="$danger3"
                    maxH="200px"
                    overflowY="auto"
                  >
                    <For each={result()!.errors}>
                      {(err) => (
                        <Text fontSize="$xs" css={{ wordBreak: "break-all" }}>
                          {err}
                        </Text>
                      )}
                    </For>
                  </Box>
                </Show>
              </VStack>
            }
          >
            <VStack alignItems="stretch" spacing="$3">
              <Text fontSize="$sm">
                {t("dedup.clean.desc", { count: props.paths.length })} ≈{" "}
                {getFileSize(props.reclaimSize)}
              </Text>
              <Box
                p="$2"
                rounded="$md"
                bgColor="$neutral2"
                maxH="180px"
                overflowY="auto"
              >
                <For each={props.paths.slice(0, 50)}>
                  {(p) => (
                    <Text
                      fontSize="$xs"
                      color="$neutral11"
                      css={{ wordBreak: "break-all" }}
                    >
                      {p}
                    </Text>
                  )}
                </For>
                <Show when={props.paths.length > 50}>
                  <Text fontSize="$xs" color="$neutral10">
                    … {props.paths.length - 50} more
                  </Text>
                </Show>
              </Box>
              <Checkbox
                checked={deleteCompanions()}
                onChange={(e: any) =>
                  setDeleteCompanions(e.currentTarget.checked)
                }
              >
                {t("dedup.clean.delete_companions")}
              </Checkbox>
              <Checkbox
                checked={removeEmptyDirs()}
                onChange={(e: any) =>
                  setRemoveEmptyDirs(e.currentTarget.checked)
                }
              >
                {t("dedup.clean.remove_empty_dirs")}
              </Checkbox>
              <Text fontSize="$xs" color="$danger9">
                {t("dedup.clean.warning")}
              </Text>
            </VStack>
          </Show>
        </ModalBody>
        <ModalFooter display="flex" gap="$2">
          <Spacer />
          <Button onClick={props.onClose} colorScheme="neutral">
            {result() ? t("global.close") : t("global.cancel")}
          </Button>
          <Show when={!result()}>
            <Button
              colorScheme="danger"
              loading={cleaning()}
              onClick={handleClean}
            >
              {t("dedup.clean.confirm")}
            </Button>
          </Show>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ==================== MergeFoldersModal 组件 ====================

interface MergeFoldersModalProps {
  taskId: string
  pair: DedupFolderPair | null
  opened: boolean
  onClose: () => void
  onDone: () => void
}

const MergeFoldersModal: Component<MergeFoldersModalProps> = (props) => {
  const t = useT()
  const [targetChoice, setTargetChoice] = createSignal<"A" | "B">("A")
  const [strategy, setStrategy] = createSignal<"rename" | "skip" | "overwrite">(
    "rename",
  )
  const [merging, doMerge] = useFetch(dedupMergeFolders)
  const [result, setResult] = createSignal<DedupMergeFoldersResp | null>(null)

  createEffect(() => {
    if (props.pair) {
      setTargetChoice("A")
      setResult(null)
    }
  })

  const targetDir = () =>
    (targetChoice() === "A" ? props.pair?.dir_a : props.pair?.dir_b) ?? ""
  const sourceDir = () =>
    (targetChoice() === "A" ? props.pair?.dir_b : props.pair?.dir_a) ?? ""

  const toDeleteCount = () => props.pair?.dup_files_count ?? 0
  const toDeleteSize = () => props.pair?.dup_files_size ?? 0
  const toMigrateCount = () => {
    if (!props.pair) return 0
    return targetChoice() === "A"
      ? Math.max(0, props.pair.total_files_b - props.pair.dup_files_count)
      : Math.max(0, props.pair.total_files_a - props.pair.dup_files_count)
  }

  const handleMerge = async () => {
    if (!props.pair || !props.taskId) return
    const res = await doMerge({
      task_id: props.taskId,
      source_dir: sourceDir(),
      target_dir: targetDir(),
      conflict_strategy: strategy(),
    })
    handleResp(res, (data) => {
      setResult(data)
      notify.success(
        t("dedup.folders.merge_success", {
          deleted: data.deleted_dup_files,
          moved: data.moved_unique_files,
          reclaimed: getFileSize(data.reclaimed_bytes),
        }),
      )
      props.onDone()
    })
  }

  return (
    <Modal
      opened={props.opened}
      onClose={() => {
        if (!merging()) props.onClose()
      }}
      size="lg"
    >
      <ModalOverlay />
      <ModalContent>
        <ModalCloseButton />
        <ModalHeader>{t("dedup.folders.modal_title")}</ModalHeader>
        <ModalBody>
          <Show
            when={result()}
            fallback={
              <VStack spacing="$4" alignItems="stretch">
                <Text fontSize="$sm" color="$neutral10">
                  {t("dedup.folders.modal_desc")}
                </Text>

                {/* 目标文件夹选择 */}
                <Box>
                  <Text fontWeight="$medium" fontSize="$sm" mb="$2">
                    {t("dedup.folders.select_target")}
                  </Text>
                  <VStack spacing="$2" alignItems="stretch">
                    <Box
                      p="$3"
                      rounded="$md"
                      border="2px solid"
                      borderColor={
                        targetChoice() === "A" ? "$accent9" : "$neutral6"
                      }
                      bgColor={
                        targetChoice() === "A" ? "$accent2" : "$neutral1"
                      }
                      cursor="pointer"
                      onClick={() => setTargetChoice("A")}
                      transition="all 0.2s"
                    >
                      <HStack spacing="$2">
                        <Badge
                          colorScheme={
                            targetChoice() === "A" ? "accent" : "neutral"
                          }
                        >
                          {targetChoice() === "A" ? "✓ 保留为目标" : "设为目标"}
                        </Badge>
                        <Text
                          fontWeight="$semibold"
                          fontSize="$sm"
                          css={{ wordBreak: "break-all" }}
                        >
                          {props.pair?.dir_a}
                        </Text>
                      </HStack>
                      <Text fontSize="$xs" color="$neutral10" mt="$1">
                        包含 {props.pair?.total_files_a} 个文件 (
                        {getFileSize(props.pair?.total_size_a ?? 0)})
                      </Text>
                    </Box>

                    <Box
                      p="$3"
                      rounded="$md"
                      border="2px solid"
                      borderColor={
                        targetChoice() === "B" ? "$accent9" : "$neutral6"
                      }
                      bgColor={
                        targetChoice() === "B" ? "$accent2" : "$neutral1"
                      }
                      cursor="pointer"
                      onClick={() => setTargetChoice("B")}
                      transition="all 0.2s"
                    >
                      <HStack spacing="$2">
                        <Badge
                          colorScheme={
                            targetChoice() === "B" ? "accent" : "neutral"
                          }
                        >
                          {targetChoice() === "B" ? "✓ 保留为目标" : "设为目标"}
                        </Badge>
                        <Text
                          fontWeight="$semibold"
                          fontSize="$sm"
                          css={{ wordBreak: "break-all" }}
                        >
                          {props.pair?.dir_b}
                        </Text>
                      </HStack>
                      <Text fontSize="$xs" color="$neutral10" mt="$1">
                        包含 {props.pair?.total_files_b} 个文件 (
                        {getFileSize(props.pair?.total_size_b ?? 0)})
                      </Text>
                    </Box>
                  </VStack>
                </Box>

                {/* 合并执行摘要 */}
                <Box p="$3" rounded="$md" bgColor="$neutral3">
                  <Text
                    fontWeight="$medium"
                    fontSize="$xs"
                    color="$neutral11"
                    mb="$1"
                  >
                    合并操作预览：
                  </Text>
                  <VStack
                    spacing="$1"
                    alignItems="flex-start"
                    fontSize="$xs"
                    color="$neutral11"
                  >
                    <Text>
                      • 源文件夹：
                      <Text as="span" color="$danger9" fontWeight="$semibold">
                        {sourceDir()}
                      </Text>
                    </Text>
                    <Text>
                      • 目标文件夹：
                      <Text as="span" color="$success9" fontWeight="$semibold">
                        {targetDir()}
                      </Text>
                    </Text>
                    <Text>
                      • 从源文件夹删除重复文件：
                      <Text as="span" color="$danger9" fontWeight="$bold">
                        {toDeleteCount()}
                      </Text>{" "}
                      个 (预计释放空间 {getFileSize(toDeleteSize())})
                    </Text>
                    <Text>
                      • 迁移源文件夹独有文件至目标：
                      <Text as="span" color="$accent9" fontWeight="$bold">
                        {toMigrateCount()}
                      </Text>{" "}
                      个
                    </Text>
                    <Text>• 完成后自动清理源文件夹空目录</Text>
                  </VStack>
                </Box>

                {/* 冲突处理策略 */}
                <Box>
                  <Text fontWeight="$medium" fontSize="$xs" mb="$2">
                    {t("dedup.folders.strategy_label")}
                  </Text>
                  <HStack spacing="$2" flexWrap="wrap">
                    <Button
                      size="xs"
                      variant={strategy() === "rename" ? "solid" : "subtle"}
                      colorScheme={
                        strategy() === "rename" ? "accent" : "neutral"
                      }
                      onClick={() => setStrategy("rename")}
                    >
                      {t("dedup.folders.strategy_rename")}
                    </Button>
                    <Button
                      size="xs"
                      variant={strategy() === "skip" ? "solid" : "subtle"}
                      colorScheme={
                        strategy() === "skip" ? "warning" : "neutral"
                      }
                      onClick={() => setStrategy("skip")}
                    >
                      {t("dedup.folders.strategy_skip")}
                    </Button>
                    <Button
                      size="xs"
                      variant={strategy() === "overwrite" ? "solid" : "subtle"}
                      colorScheme={
                        strategy() === "overwrite" ? "danger" : "neutral"
                      }
                      onClick={() => setStrategy("overwrite")}
                    >
                      {t("dedup.folders.strategy_overwrite")}
                    </Button>
                  </HStack>
                </Box>

                {/* 警示提示 */}
                <Box
                  p="$2.5"
                  rounded="$md"
                  bgColor="$warning3"
                  border="1px solid"
                  borderColor="$warning6"
                >
                  <Text fontSize="$xs" color="$warning11">
                    ⚠️ {t("dedup.folders.warning_tip")}
                  </Text>
                </Box>
              </VStack>
            }
          >
            {/* 合并结果展示 */}
            <VStack spacing="$3" alignItems="stretch" p="$2">
              <Box
                p="$4"
                rounded="$md"
                bgColor="$success2"
                border="1px solid"
                borderColor="$success6"
                textAlign="center"
              >
                <Text
                  fontSize="$base"
                  fontWeight="$bold"
                  color="$success11"
                  mb="$2"
                >
                  🎉 文件夹合并完成！
                </Text>
                <Text fontSize="$sm" color="$neutral11">
                  删除了{" "}
                  <Text as="span" fontWeight="$bold" color="$danger9">
                    {result()!.deleted_dup_files}
                  </Text>{" "}
                  个重复文件
                </Text>
                <Text fontSize="$sm" color="$neutral11">
                  移动了{" "}
                  <Text as="span" fontWeight="$bold" color="$accent9">
                    {result()!.moved_unique_files}
                  </Text>{" "}
                  个独有文件
                </Text>
                <Text fontSize="$sm" color="$neutral11">
                  释放空间：{" "}
                  <Text as="span" fontWeight="$bold" color="$success10">
                    {getFileSize(result()!.reclaimed_bytes)}
                  </Text>
                </Text>
                <Show when={result()!.source_removed}>
                  <Text fontSize="$xs" color="$neutral10" mt="$1">
                    源文件夹已成功清除
                  </Text>
                </Show>
                <Show when={result()!.errors && result()!.errors!.length > 0}>
                  <Box mt="$2" p="$2" rounded="$md" bgColor="$danger2">
                    <For each={result()!.errors}>
                      {(err) => (
                        <Text fontSize="$xs" color="$danger9">
                          {err}
                        </Text>
                      )}
                    </For>
                  </Box>
                </Show>
              </Box>
            </VStack>
          </Show>
        </ModalBody>
        <ModalFooter display="flex" gap="$2">
          <Spacer />
          <Button onClick={props.onClose} colorScheme="neutral">
            {result() ? t("global.close") : t("global.cancel")}
          </Button>
          <Show when={!result()}>
            <Button
              colorScheme="accent"
              loading={merging()}
              onClick={handleMerge}
            >
              {t("dedup.folders.confirm_merge")}
            </Button>
          </Show>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ==================== HistoryDrawerContent 组件 ====================

interface HistoryDrawerProps {
  refreshKey: number
  onSelect: (item: DedupTaskHistoryItem) => void
  onReuse?: (item: DedupTaskHistoryItem) => void
  onDeleted: () => void
}

const HistoryDrawerContent: Component<HistoryDrawerProps> = (props) => {
  const t = useT()
  const [page, setPage] = createSignal(1)
  const [total, setTotal] = createSignal(0)
  const [tasks, setTasks] = createSignal<DedupTaskHistoryItem[]>([])
  const [kw, setKw] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal("all")
  const [fetching, getHistory] = useFetch(dedupHistory)
  const [deleting, deleteItem] = useFetch(dedupDeleteHistory)
  const [clearing, setClearing] = createSignal(false)

  const loadHistory = async () => {
    const filterVal = statusFilter() === "all" ? "" : statusFilter()
    const res = await getHistory(page(), 20, (kw() || "").trim(), filterVal)
    handleResp(
      res,
      (data) => {
        setTasks(data.content ?? [])
        setTotal(data.total ?? 0)
      },
      () => {
        setTasks([])
        setTotal(0)
      },
    )
  }

  createEffect(() => {
    props.refreshKey
    page()
    kw()
    statusFilter()
    loadHistory()
  })

  const filterTabs = [
    { key: "all", label: "全部" },
    { key: "pending", label: "待处理" },
    { key: "cleaned", label: "已完成" },
    { key: "empty", label: "无重复" },
  ]

  const getTaskStatus = (task: DedupTaskHistoryItem) => {
    if (task.state !== "finished") {
      return {
        label: t(stateI18nKey(task.state)),
        color: stateColor(task.state),
      }
    }
    if (task.dup_groups > 0) {
      if ((task.cleaned_files ?? 0) > 0) {
        return {
          label: `处理中 (${task.cleaned_files} 已清)`,
          color: "accent" as const,
        }
      }
      return { label: "待处理", color: "warning" as const }
    }
    const initGrp = task.initial_dup_groups ?? 0
    const initFiles = task.initial_dup_files ?? 0
    if (initGrp > 0 || initFiles > 0 || (task.cleaned_files ?? 0) > 0) {
      return { label: "已完全清理 🎉", color: "success" as const }
    }
    return { label: "无重复", color: "neutral" as const }
  }

  const handleClearEmpty = async () => {
    if (!window.confirm("确定清空所有无重复记录和已完全清理的历史吗？")) return
    setClearing(true)
    try {
      const res = await dedupClearEmptyHistory()
      handleResp(
        res,
        (data) => {
          notify.success(
            `已清理 ${data?.deleted_count ?? data?.deleted ?? 0} 条记录`,
          )
          loadHistory()
          props.onDeleted?.()
        },
        (err) => notify.error(err),
      )
    } catch (err: any) {
      notify.error(err?.message || "清理失败")
    } finally {
      setClearing(false)
    }
  }

  return (
    <VStack w="$full" alignItems="stretch" spacing="$3">
      <VStack spacing="$2" w="$full">
        <HStack spacing="$2" alignItems="center">
          <Input
            size="sm"
            flex="1"
            placeholder="🔍 搜索历史路径..."
            value={kw()}
            onInput={(e: any) => {
              setKw(e.currentTarget.value)
              if (page() !== 1) setPage(1)
            }}
          />
          <Show when={!!kw()}>
            <Button
              size="sm"
              variant="ghost"
              colorScheme="neutral"
              onClick={() => {
                setKw("")
                if (page() !== 1) setPage(1)
              }}
            >
              清空
            </Button>
          </Show>
        </HStack>
        <HStack
          spacing="$1_5"
          alignItems="center"
          flexWrap="wrap"
          justifyContent="space-between"
        >
          <HStack spacing="$1_5" flexWrap="wrap">
            <For each={filterTabs}>
              {(tab) => (
                <Button
                  size="xs"
                  variant={statusFilter() === tab.key ? "solid" : "subtle"}
                  colorScheme={statusFilter() === tab.key ? "info" : "neutral"}
                  onClick={() => {
                    setStatusFilter(tab.key)
                    if (page() !== 1) setPage(1)
                  }}
                >
                  {tab.label}
                </Button>
              )}
            </For>
          </HStack>
          <Button
            size="xs"
            variant="outline"
            colorScheme="neutral"
            loading={clearing()}
            onClick={handleClearEmpty}
          >
            🧹 清理无重复记录
          </Button>
        </HStack>
      </VStack>

      <Show
        when={!fetching()}
        fallback={
          <HStack justifyContent="center" p="$6">
            <Spinner />
          </HStack>
        }
      >
        <Show
          when={tasks().length > 0}
          fallback={
            <Box
              p="$8"
              textAlign="center"
              rounded="$lg"
              bgColor="$neutral2"
              color="$neutral10"
            >
              {t("dedup.history.empty")}
            </Box>
          }
        >
          <For each={tasks()}>
            {(item) => {
              const stInfo = getTaskStatus(item)
              const cfgParts: string[] = []
              if (item.max_depth) cfgParts.push(`深度: ${item.max_depth}`)
              if (item.concurrency) cfgParts.push(`并发: ${item.concurrency}`)
              if (item.qps) cfgParts.push(`QPS: ${item.qps}`)
              if (item.min_size && item.min_size > 0) {
                cfgParts.push(`最小: ${getFileSize(item.min_size)}`)
              }
              if (item.include_exts) cfgParts.push(`包含: ${item.include_exts}`)
              if (item.exclude_exts) cfgParts.push(`排除: ${item.exclude_exts}`)
              const cfgStr = cfgParts.join(" · ")
              const isPending = item.state === "finished" && item.dup_groups > 0
              const isCleaned =
                item.state === "finished" &&
                item.dup_groups === 0 &&
                ((item.initial_dup_groups ?? 0) > 0 ||
                  (item.initial_dup_files ?? 0) > 0)
              const hasCleaned =
                (item.cleaned_files ?? 0) > 0 || (item.cleaned_bytes ?? 0) > 0

              return (
                <Box
                  border="1px solid"
                  borderColor="$neutral5"
                  rounded="$lg"
                  p="$3_5"
                  bgColor="$neutral1"
                >
                  <HStack spacing="$2" flexWrap="wrap" alignItems="center">
                    <Badge colorScheme={stInfo.color} fontSize="$xs">
                      {stInfo.label}
                    </Badge>
                    <Text
                      fontSize="$sm"
                      fontWeight="$semibold"
                      css={{ wordBreak: "break-all", color: "$info11" }}
                    >
                      {item.root_path}
                    </Text>
                    <Spacer />
                    <Text fontSize="$xs" color="$neutral10">
                      {formatDate(item.started_at)}
                    </Text>
                  </HStack>

                  <Show
                    when={
                      item.state === "running" ||
                      item.state === "queued" ||
                      item.state === "canceling"
                    }
                  >
                    <Box mt="$2">
                      <TaskProgressBar
                        isIndeterminate={true}
                        startTime={item.started_at}
                        statusText="正在后台扫描中..."
                      />
                    </Box>
                  </Show>

                  <Show when={!!cfgStr}>
                    <Text fontSize="$xs" color="$neutral10" mt="$1_5">
                      ⚙️ 配置: {cfgStr}
                    </Text>
                  </Show>

                  <HStack spacing="$3" mt="$2" flexWrap="wrap">
                    <Show when={hasCleaned}>
                      <Text fontSize="$xs" color="$success11">
                        已清理: {item.cleaned_files} 文件 · 释放{" "}
                        {getFileSize(item.cleaned_bytes ?? 0)}
                      </Text>
                    </Show>
                    <Text fontSize="$xs" color="$neutral11">
                      {hasCleaned
                        ? `剩余重复: ${item.dup_groups} 组 · ${item.dup_files} 文件 · ${getFileSize(
                            item.wasted_total,
                          )}`
                        : `重复组: ${item.dup_groups} · 重复文件: ${
                            item.dup_files
                          } · 可释放: ${getFileSize(item.wasted_total)}`}
                    </Text>
                    <Show when={item.candidate_groups > 0}>
                      <Text fontSize="$xs" color="$warning11">
                        待确认: {item.candidate_groups} 组
                      </Text>
                    </Show>
                  </HStack>

                  <HStack
                    spacing="$2"
                    mt="$3"
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <Button
                      size="xs"
                      colorScheme={
                        item.state === "running"
                          ? "info"
                          : isPending
                            ? "accent"
                            : isCleaned
                              ? "success"
                              : "info"
                      }
                      variant={
                        item.state === "running" || isPending
                          ? "solid"
                          : "subtle"
                      }
                      onClick={() => props.onSelect(item)}
                    >
                      {item.state === "running"
                        ? "🚀 查看实时进度"
                        : isPending
                          ? "🚀 继续处理"
                          : isCleaned
                            ? "查看结果"
                            : "载入此任务"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      colorScheme="info"
                      onClick={() => props.onReuse?.(item)}
                    >
                      🔄 复用配置
                    </Button>
                    <Spacer />
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="danger"
                      loading={deleting()}
                      onClick={async () => {
                        const res = await deleteItem(item.id)
                        handleResp(
                          res,
                          () => {
                            props.onDeleted()
                            loadHistory()
                          },
                          (err) => notify.error(err),
                        )
                      }}
                    >
                      {t("dedup.history.delete")}
                    </Button>
                  </HStack>
                </Box>
              )
            }}
          </For>
        </Show>
      </Show>

      <Show when={total() > 20}>
        <HStack justifyContent="center">
          <Paginator
            total={total()}
            defaultPageSize={20}
            defaultCurrent={1}
            onChange={(p) => setPage(p)}
          />
        </HStack>
      </Show>
    </VStack>
  )
}

// ==================== ResultList 组件 ====================

interface ResultListProps {
  taskId: string
  verified: boolean
  refreshKey: number
  onRequestClean: (paths: string[], reclaimBytes: number) => void
}

const ResultList: Component<ResultListProps> = (props) => {
  const t = useT()
  const [page, setPage] = createSignal(1)
  const [total, setTotal] = createSignal(0)
  const [groups, setGroups] = createSignal<DedupGroup[]>([])
  const [selectedPaths, setSelectedPaths] = createSignal<string[]>([])
  const [fetching, getResult] = useFetch(dedupResult)
  const [kw, setKw] = createSignal("")
  let resetPaginator: (() => void) | undefined

  const loadResult = async () => {
    if (!props.taskId) {
      setGroups([])
      setTotal(0)
      return
    }
    const res = await getResult(
      props.taskId,
      page(),
      20,
      props.verified ? "1" : "0",
    )
    handleResp(
      res,
      (data) => {
        setGroups(data.groups ?? [])
        setTotal(data.total ?? 0)
      },
      () => {
        setGroups([])
        setTotal(0)
      },
    )
  }

  createEffect(() => {
    props.taskId
    props.verified
    props.refreshKey
    setPage(1)
    resetPaginator?.()
  })

  createEffect(() => {
    props.taskId
    props.verified
    props.refreshKey
    page()
    setSelectedPaths([])
    loadResult()
  })

  const totalReclaimBytes = createMemo(() => {
    const sel = selectedPaths()
    return groups().reduce((acc, g) => acc + calcGroupWasted(g, sel), 0)
  })

  const findGroupByFilePath = (path: string) => {
    return groups().find((g) => g.files.some((f) => f.path === path))
  }

  const handleSelectFile = (path: string, checked: boolean) => {
    if (checked) {
      const g = findGroupByFilePath(path)
      if (g) {
        const remaining = g.files.filter(
          (f) => f.path !== path && !selectedPaths().includes(f.path),
        )
        if (remaining.length === 0) {
          notify.warning(t("dedup.result.keep_last_hint"))
          return
        }
      }
    }
    setSelectedPaths((prev) =>
      checked ? [...new Set([...prev, path])] : prev.filter((p) => p !== path),
    )
  }

  const selectWholeGroup = (group: DedupGroup, checked: boolean) => {
    const all = group.files.map((f) => f.path)
    const targets = checked
      ? all.filter((p) => p !== getOriginalPath(group))
      : all
    setSelectedPaths((prev) =>
      checked
        ? [...new Set([...prev, ...targets])]
        : prev.filter((p) => !targets.includes(p)),
    )
  }

  const keepInGroup = (
    group: DedupGroup,
    mode: "oldest" | "newest" | "shortest" | "longest",
  ) => {
    const targets = getCopiesToClean(group, mode)
    const all = group.files.map((f) => f.path)
    setSelectedPaths((prev) => [
      ...new Set([...prev.filter((p) => !all.includes(p)), ...targets]),
    ])
  }

  const smartAll = (mode: "oldest" | "newest" | "shortest" | "longest") => {
    const targets: string[] = []
    for (const g of groups()) {
      targets.push(...getCopiesToClean(g, mode))
    }
    setSelectedPaths([...new Set(targets)])
    const notifyMsgs: Record<string, string> = {
      oldest: "已一键勾选当前页每组除最旧外的所有副本",
      newest: "已一键勾选当前页每组除最新外的所有副本",
      shortest: "已一键勾选当前页每组除最短路径外的所有副本 (保留最短路径)",
      longest: "已一键勾选当前页每组除最长路径外的所有副本 (保留最长路径)",
    }
    notify.success(notifyMsgs[mode])
  }

  const smartPath = (action: "keep" | "clean") => {
    const term = (kw() || "").trim().toLowerCase()
    if (!term) {
      notify.warning("请输入路径关键词（如 /backup/）")
      return
    }
    const targets: string[] = []
    for (const g of groups()) {
      const sorted = sortGroupFiles(g)
      const matches = sorted.filter((f) => f.path.toLowerCase().includes(term))
      const nonMatches = sorted.filter(
        (f) => !f.path.toLowerCase().includes(term),
      )
      if (action === "keep") {
        if (matches.length > 0) {
          if (nonMatches.length > 0) {
            targets.push(...nonMatches.map((f) => f.path))
          } else {
            targets.push(...matches.slice(1).map((f) => f.path))
          }
        } else {
          targets.push(...sorted.slice(1).map((f) => f.path))
        }
      } else {
        if (matches.length > 0) {
          if (nonMatches.length > 0) {
            targets.push(...matches.map((f) => f.path))
          } else {
            targets.push(...matches.slice(1).map((f) => f.path))
          }
        }
      }
    }
    setSelectedPaths([...new Set(targets)])
    notify.success(
      action === "keep"
        ? `已优先保留包含 "${term}" 的副本`
        : `已优先勾选包含 "${term}" 的副本`,
    )
  }

  const topGroups = createMemo(() =>
    [...groups()].sort((a, b) => b.wasted_bytes - a.wasted_bytes).slice(0, 5),
  )

  const catStats = createMemo(() => {
    const map: Record<
      string,
      { label: string; color: any; bytes: number; count: number }
    > = {}
    for (const g of groups()) {
      const cat = getCategory(g.files[0]?.name || "")
      if (!map[cat.key]) {
        map[cat.key] = {
          label: cat.label,
          color: cat.color,
          bytes: 0,
          count: 0,
        }
      }
      map[cat.key].bytes += g.wasted_bytes
      map[cat.key].count += g.files.length - 1
    }
    return Object.values(map).sort((a, b) => b.bytes - a.bytes)
  })

  return (
    <VStack w="$full" alignItems="stretch" spacing="$3">
      <Show
        when={!fetching()}
        fallback={
          <HStack justifyContent="center" p="$6">
            <Spinner />
          </HStack>
        }
      >
        <Show
          when={groups().length > 0}
          fallback={
            <Box
              p="$8"
              textAlign="center"
              rounded="$lg"
              bgColor="$neutral2"
              color="$neutral10"
            >
              {props.verified
                ? t("dedup.result.empty")
                : t("dedup.result.empty_candidates")}
            </Box>
          }
        >
          <Show when={props.verified && groups().length > 0}>
            <Box
              border="1px solid"
              borderColor="$neutral4"
              rounded="$lg"
              p="$3"
              bgColor="$neutral1"
            >
              <VStack alignItems="stretch" spacing="$2">
                <HStack alignItems="center" spacing="$2" flexWrap="wrap">
                  <Text fontSize="$xs" fontWeight="$bold" color="$neutral12">
                    📊 空间分析与分类分布:
                  </Text>
                  <For each={catStats()}>
                    {(item) => (
                      <Badge
                        variant="subtle"
                        colorScheme={item.color}
                        fontSize="$xs"
                      >
                        {item.label}: {getFileSize(item.bytes)}
                      </Badge>
                    )}
                  </For>
                </HStack>
                <Show when={topGroups().length > 0}>
                  <HStack alignItems="center" spacing="$1" flexWrap="wrap">
                    <Text fontSize="$xs" color="$neutral10">
                      Top 空间占用:
                    </Text>
                    <For each={topGroups()}>
                      {(g) => (
                        <Badge
                          variant="outline"
                          colorScheme="danger"
                          fontSize="$xs"
                          maxW="180px"
                          css={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.files[0]?.name || "文件"} (
                          {getFileSize(g.wasted_bytes)})
                        </Badge>
                      )}
                    </For>
                  </HStack>
                </Show>
              </VStack>
            </Box>
          </Show>

          <Show when={props.verified}>
            <HStack
              spacing="$2"
              p="$2_5"
              rounded="$lg"
              bgColor="$neutral2"
              border="1px solid"
              borderColor="$neutral4"
              flexWrap="wrap"
              gap="$1_5"
              alignItems="center"
            >
              <Text fontSize="$xs" fontWeight="$semibold" color="$neutral12">
                ⚡ 智能清理预设:
              </Text>
              <Button
                size="xs"
                variant="subtle"
                colorScheme="info"
                onClick={() => smartAll("oldest")}
              >
                {t("dedup.result.preset_oldest") || "保留每组最旧"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                colorScheme="info"
                onClick={() => smartAll("newest")}
              >
                {t("dedup.result.preset_newest") || "保留每组最新"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                colorScheme="accent"
                onClick={() => smartAll("shortest")}
                title="保留每组中路径最短的文件，勾选较长路径副本以便清理"
              >
                {t("dedup.result.preset_shortest") || "保留最短路径"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                colorScheme="accent"
                onClick={() => smartAll("longest")}
                title="保留每组中路径最长的文件，勾选较短路径副本以便清理"
              >
                {t("dedup.result.preset_longest") || "保留最长路径"}
              </Button>
              <Input
                size="xs"
                flex="1 1 140px"
                minW="120px"
                placeholder="路径关键词如 /backup/"
                value={kw()}
                onInput={(e: any) => setKw(e.currentTarget.value)}
              />
              <Button
                size="xs"
                variant="ghost"
                colorScheme="accent"
                onClick={() => smartPath("keep")}
              >
                路径优先保留
              </Button>
              <Button
                size="xs"
                variant="ghost"
                colorScheme="danger"
                onClick={() => smartPath("clean")}
              >
                路径优先清理
              </Button>
              <Spacer />
              <Show when={selectedPaths().length > 0}>
                <Button
                  size="xs"
                  variant="ghost"
                  colorScheme="neutral"
                  onClick={() => setSelectedPaths([])}
                >
                  清空勾选 ({selectedPaths().length})
                </Button>
              </Show>
            </HStack>
          </Show>

          <For each={groups()}>
            {(g) => {
              const isLarge = g.size >= 524288000
              const isMany = g.files.length >= 4
              const isCrossDir =
                new Set(
                  g.files.map((f) =>
                    f.path.substring(0, f.path.lastIndexOf("/")),
                  ),
                ).size > 1

              return (
                <Box
                  border="1px solid"
                  borderColor="$neutral5"
                  rounded="$lg"
                  p="$4"
                  bgColor="$neutral1"
                >
                  <HStack spacing="$2" mb="$3" flexWrap="wrap">
                    <Badge colorScheme={props.verified ? "success" : "warning"}>
                      {g.hash_type
                        ? `${g.hash_type.toUpperCase()} · ${getFileSize(g.size)}`
                        : getFileSize(g.size)}
                    </Badge>
                    <Text fontSize="$sm" color="$neutral10">
                      {g.files.length} {t("dedup.result.copies")}
                    </Text>
                    <Badge colorScheme="info">
                      {t("dedup.result.reclaimable")}:{" "}
                      {getFileSize(g.wasted_bytes)}
                    </Badge>
                    <Show when={isLarge}>
                      <Badge
                        colorScheme="danger"
                        variant="solid"
                        fontSize="$xs"
                      >
                        🔥 超大文件
                      </Badge>
                    </Show>
                    <Show when={isMany}>
                      <Badge
                        colorScheme="accent"
                        variant="subtle"
                        fontSize="$xs"
                      >
                        {g.files.length} 份多副本
                      </Badge>
                    </Show>
                    <Show when={isCrossDir}>
                      <Badge colorScheme="info" variant="subtle" fontSize="$xs">
                        跨目录
                      </Badge>
                    </Show>
                    <Spacer />
                    <Show when={props.verified}>
                      <Button
                        size="xs"
                        variant="subtle"
                        colorScheme="neutral"
                        onClick={() => keepInGroup(g, "oldest")}
                      >
                        {t("dedup.result.keep_oldest")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        colorScheme="neutral"
                        onClick={() => keepInGroup(g, "newest")}
                      >
                        {t("dedup.result.keep_newest")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        colorScheme="neutral"
                        onClick={() => keepInGroup(g, "shortest")}
                        title="保留此组中路径最短的文件，勾选较长路径副本"
                      >
                        {t("dedup.result.keep_shortest")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        colorScheme="neutral"
                        onClick={() => keepInGroup(g, "longest")}
                        title="保留此组中路径最长的文件，勾选较短路径副本"
                      >
                        {t("dedup.result.keep_longest")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        colorScheme="accent"
                        onClick={() =>
                          selectWholeGroup(
                            g,
                            !g.files.every((f) =>
                              selectedPaths().includes(f.path),
                            ),
                          )
                        }
                      >
                        {t("dedup.result.select_group")}
                      </Button>
                    </Show>
                  </HStack>

                  <VStack alignItems="stretch" spacing="$1">
                    <For each={sortGroupFiles(g)}>
                      {(file) => {
                        const parentDir =
                          file.path.lastIndexOf("/") > 0
                            ? file.path.substring(0, file.path.lastIndexOf("/"))
                            : "/"
                        const ext = (
                          file.name.split(".").pop() || ""
                        ).toUpperCase()
                        const cat = getCategory(file.name)

                        return (
                          <HStack
                            spacing="$2"
                            px="$2"
                            py="$2"
                            rounded="$md"
                            _hover={{ bgColor: "$neutral3" }}
                            alignItems="flex-start"
                          >
                            <Show when={props.verified}>
                              <Checkbox
                                mt="$1"
                                checked={selectedPaths().includes(file.path)}
                                onChange={(e: any) =>
                                  handleSelectFile(
                                    file.path,
                                    e.currentTarget.checked,
                                  )
                                }
                              />
                            </Show>
                            <VStack
                              alignItems="start"
                              spacing="$0_5"
                              flex="1"
                              minW="0"
                            >
                              <HStack
                                spacing="$1_5"
                                alignItems="center"
                                flexWrap="wrap"
                              >
                                <Badge
                                  variant="subtle"
                                  colorScheme={cat.color}
                                  fontSize="$xs"
                                >
                                  {ext || "FILE"}
                                </Badge>
                                <Text
                                  as="a"
                                  href={file.path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  fontSize="$sm"
                                  color="$info10"
                                  _hover={{ textDecoration: "underline" }}
                                  css={{ wordBreak: "break-all" }}
                                  title={`在新标签原生预览: ${file.path}`}
                                >
                                  {file.path}
                                </Text>
                                <Button
                                  as="a"
                                  href={parentDir}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="xs"
                                  variant="ghost"
                                  colorScheme="neutral"
                                  px="$1_5"
                                  h="$5"
                                  title={`在新标签定位目录: ${parentDir}`}
                                >
                                  📁 定位
                                </Button>
                              </HStack>
                              <Text fontSize="$xs" color="$neutral10">
                                {formatDate(file.modified)}
                              </Text>
                            </VStack>
                            <Show
                              when={
                                props.verified &&
                                !selectedPaths().includes(file.path)
                              }
                            >
                              <Tag colorScheme="info" fontSize="$xs">
                                {t("dedup.result.keep_mark")}
                              </Tag>
                            </Show>
                          </HStack>
                        )
                      }}
                    </For>
                  </VStack>
                </Box>
              )
            }}
          </For>

          <Show when={total() > 20}>
            <HStack justifyContent="center">
              <Paginator
                total={total()}
                defaultPageSize={20}
                defaultCurrent={1}
                onChange={(p) => setPage(p)}
                setResetCallback={(fn) => (resetPaginator = fn)}
              />
            </HStack>
          </Show>

          <Show when={props.verified}>
            <HStack
              pos="sticky"
              bottom="$4"
              zIndex={20}
              p="$3"
              spacing="$3"
              rounded="$lg"
              bgColor="$neutral2"
              shadow="0px 10px 30px -5px rgba(0, 0, 0, 0.25)"
              flexWrap="wrap"
              gap="$2"
            >
              <Text fontSize="$sm">
                {t("dedup.result.selected", { count: selectedPaths().length })}{" "}
                · {t("dedup.result.will_reclaim")}:{" "}
                {getFileSize(totalReclaimBytes())}
              </Text>
              <Spacer />
              <Button
                size="sm"
                variant="ghost"
                disabled={selectedPaths().length === 0}
                onClick={() => setSelectedPaths([])}
              >
                {t("dedup.result.clear_selection")}
              </Button>
              <Button
                size="sm"
                colorScheme="danger"
                disabled={selectedPaths().length === 0}
                onClick={() =>
                  props.onRequestClean(selectedPaths(), totalReclaimBytes())
                }
              >
                {t("dedup.result.clean")}
              </Button>
            </HStack>
          </Show>
        </Show>
      </Show>
    </VStack>
  )
}

// ==================== FolderPairList 组件 ====================

interface FolderPairListProps {
  taskId: string
  refreshKey: number
  onOpenMerge: (pair: DedupFolderPair) => void
}

const FolderPairList: Component<FolderPairListProps> = (props) => {
  const t = useT()
  const [pairs, setPairs] = createSignal<DedupFolderPair[]>([])
  const [threshold, setThreshold] = createSignal(0.3)
  const [kw, setKw] = createSignal("")
  const [expandedIndices, setExpandedIndices] = createSignal<number[]>([])
  const [fetching, getFolders] = useFetch(dedupFolders)

  const loadFolders = async () => {
    if (!props.taskId) return
    const res = await getFolders(props.taskId, threshold())
    handleResp(res, (data) => {
      setPairs(data.folders || [])
      setExpandedIndices([])
    })
  }

  createEffect(() => {
    if (props.taskId) {
      loadFolders()
    }
  })

  createEffect(() => {
    if (props.refreshKey && props.taskId) {
      loadFolders()
    }
  })

  const filteredPairs = createMemo(() => {
    const list = pairs()
    const query = kw().trim().toLowerCase()
    if (!query) return list
    return list.filter(
      (p) =>
        p.dir_a.toLowerCase().includes(query) ||
        p.dir_b.toLowerCase().includes(query),
    )
  })

  const toggleExpand = (idx: number) => {
    if (expandedIndices().includes(idx)) {
      setExpandedIndices(expandedIndices().filter((i) => i !== idx))
    } else {
      setExpandedIndices([...expandedIndices(), idx])
    }
  }

  const similarityColor = (sim: number): "success" | "warning" | "info" => {
    if (sim >= 0.8) return "success"
    if (sim >= 0.5) return "warning"
    return "info"
  }

  return (
    <VStack spacing="$3" alignItems="stretch" mt="$2">
      {/* 头部筛选区 */}
      <HStack spacing="$2" flexWrap="wrap">
        <Text fontSize="$sm" fontWeight="$medium" color="$neutral11">
          {t("dedup.folders.threshold")}:
        </Text>
        <Button
          size="xs"
          variant={threshold() === 0.3 ? "solid" : "subtle"}
          colorScheme="accent"
          onClick={() => setThreshold(0.3)}
        >
          {t("dedup.folders.filter_all")}
        </Button>
        <Button
          size="xs"
          variant={threshold() === 0.5 ? "solid" : "subtle"}
          colorScheme="accent"
          onClick={() => setThreshold(0.5)}
        >
          {t("dedup.folders.filter_50")}
        </Button>
        <Button
          size="xs"
          variant={threshold() === 0.8 ? "solid" : "subtle"}
          colorScheme="accent"
          onClick={() => setThreshold(0.8)}
        >
          {t("dedup.folders.filter_80")}
        </Button>
        <Button
          size="xs"
          variant={threshold() === 1.0 ? "solid" : "subtle"}
          colorScheme="accent"
          onClick={() => setThreshold(1.0)}
        >
          {t("dedup.folders.filter_100")}
        </Button>

        <Spacer />

        <Input
          size="xs"
          placeholder="搜索文件夹路径..."
          w="180px"
          value={kw()}
          onInput={(e: any) => setKw(e.currentTarget.value)}
        />
        <Button
          size="xs"
          variant="subtle"
          loading={fetching()}
          onClick={loadFolders}
        >
          <BsArrowRepeat />
        </Button>
      </HStack>

      <HStack justify="space-between">
        <Text fontSize="$xs" color="$neutral10">
          {t("dedup.folders.desc")}
        </Text>
        <Badge colorScheme="accent">
          {t("dedup.folders.matched_count", { count: filteredPairs().length })}
        </Badge>
      </HStack>

      {/* 列表加载状态 */}
      <Show when={fetching()}>
        <Flex justify="center" p="$8">
          <Spinner />
        </Flex>
      </Show>

      {/* 空状态 */}
      <Show when={!fetching() && filteredPairs().length === 0}>
        <Box
          p="$8"
          textAlign="center"
          rounded="$lg"
          bgColor="$neutral2"
          color="$neutral10"
        >
          {t("dedup.folders.empty")}
        </Box>
      </Show>

      {/* 重复文件夹对卡片列表 */}
      <Show when={!fetching() && filteredPairs().length > 0}>
        <For each={filteredPairs()}>
          {(pair, idx) => {
            const isExpanded = () => expandedIndices().includes(idx())
            const simPercent = Math.round(pair.similarity * 100)
            const ratioAPercent = (pair.ratio_a * 100).toFixed(0)
            const ratioBPercent = (pair.ratio_b * 100).toFixed(0)

            return (
              <Box
                border="1px solid"
                borderColor="$neutral5"
                rounded="$lg"
                p="$3.5"
                bgColor="$neutral1"
                shadow="$xs"
              >
                {/* 顶部指标与一键合并按钮 */}
                <Flex
                  justify="space-between"
                  align="center"
                  wrap="wrap"
                  gap="$2"
                  pb="$2"
                  borderBottom="1px dashed"
                  borderColor="$neutral4"
                >
                  <HStack spacing="$2" flexWrap="wrap">
                    <Badge colorScheme={similarityColor(pair.similarity)}>
                      相似度 {simPercent}%
                    </Badge>
                    <Text fontSize="$xs" color="$neutral11">
                      重合文件:{" "}
                      <Text as="span" fontWeight="$bold" color="$danger9">
                        {pair.dup_files_count}
                      </Text>{" "}
                      个
                    </Text>
                    <Text fontSize="$xs" color="$neutral11">
                      可释放:{" "}
                      <Text as="span" fontWeight="$bold" color="$success10">
                        {getFileSize(pair.dup_files_size)}
                      </Text>
                    </Text>
                  </HStack>

                  <HStack spacing="$2">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => toggleExpand(idx())}
                    >
                      {isExpanded()
                        ? t("dedup.folders.hide_detail")
                        : `${t("dedup.folders.view_detail")} (${
                            pair.matched_files?.length ?? pair.dup_files_count
                          })`}
                    </Button>
                    <Button
                      size="xs"
                      colorScheme="accent"
                      onClick={() => props.onOpenMerge(pair)}
                    >
                      {t("dedup.folders.merge_btn")}
                    </Button>
                  </HStack>
                </Flex>

                {/* 两个文件夹对比 */}
                <Flex
                  direction={{ "@initial": "column", "@sm": "row" }}
                  gap="$3"
                  mt="$2.5"
                >
                  {/* 文件夹 A */}
                  <Box
                    flex="1"
                    p="$2.5"
                    rounded="$md"
                    bgColor="$neutral2"
                    border="1px solid"
                    borderColor="$neutral4"
                  >
                    <HStack spacing="$1.5" mb="$1">
                      <Tag size="sm" colorScheme="info">
                        目录 A
                      </Tag>
                      <Text
                        fontSize="$xs"
                        fontWeight="$semibold"
                        css={{ wordBreak: "break-all" }}
                      >
                        {pair.dir_a}
                      </Text>
                    </HStack>
                    <HStack
                      spacing="$3"
                      fontSize="$xs"
                      color="$neutral10"
                      flexWrap="wrap"
                    >
                      <Text>文件数: {pair.total_files_a}</Text>
                      <Text>总大小: {getFileSize(pair.total_size_a)}</Text>
                      <Text color="$warning10">重复占比: {ratioAPercent}%</Text>
                      <Text color="$neutral9">
                        独有: {pair.total_files_a - pair.dup_files_count}
                      </Text>
                    </HStack>
                  </Box>

                  {/* 文件夹 B */}
                  <Box
                    flex="1"
                    p="$2.5"
                    rounded="$md"
                    bgColor="$neutral2"
                    border="1px solid"
                    borderColor="$neutral4"
                  >
                    <HStack spacing="$1.5" mb="$1">
                      <Tag size="sm" colorScheme="accent">
                        目录 B
                      </Tag>
                      <Text
                        fontSize="$xs"
                        fontWeight="$semibold"
                        css={{ wordBreak: "break-all" }}
                      >
                        {pair.dir_b}
                      </Text>
                    </HStack>
                    <HStack
                      spacing="$3"
                      fontSize="$xs"
                      color="$neutral10"
                      flexWrap="wrap"
                    >
                      <Text>文件数: {pair.total_files_b}</Text>
                      <Text>总大小: {getFileSize(pair.total_size_b)}</Text>
                      <Text color="$warning10">重复占比: {ratioBPercent}%</Text>
                      <Text color="$neutral9">
                        独有: {pair.total_files_b - pair.dup_files_count}
                      </Text>
                    </HStack>
                  </Box>
                </Flex>

                {/* 展开比对明细 */}
                <Show
                  when={
                    isExpanded() &&
                    pair.matched_files &&
                    pair.matched_files.length > 0
                  }
                >
                  <Box
                    mt="$3"
                    p="$2.5"
                    rounded="$md"
                    bgColor="$neutral2"
                    border="1px solid"
                    borderColor="$neutral4"
                    maxH="240px"
                    overflowY="auto"
                  >
                    <Text
                      fontSize="$xs"
                      fontWeight="$bold"
                      color="$neutral11"
                      mb="$2"
                    >
                      重合文件清单 ({pair.matched_files!.length} 个)：
                    </Text>
                    <VStack spacing="$1.5" alignItems="stretch">
                      <For each={pair.matched_files}>
                        {(f) => (
                          <Flex
                            direction={{ "@initial": "column", "@sm": "row" }}
                            justify="space-between"
                            p="$1.5"
                            rounded="$sm"
                            bgColor="$neutral1"
                            fontSize="$xs"
                            gap="$1"
                          >
                            <VStack
                              spacing="$0.5"
                              alignItems="flex-start"
                              flex="1"
                            >
                              <Text
                                color="$neutral11"
                                css={{ wordBreak: "break-all" }}
                              >
                                📄 A: {f.name_a}
                              </Text>
                              <Show when={f.name_a !== f.name_b}>
                                <Text
                                  color="$neutral9"
                                  css={{ wordBreak: "break-all" }}
                                >
                                  📄 B: {f.name_b}
                                </Text>
                              </Show>
                            </VStack>
                            <Badge
                              colorScheme="neutral"
                              alignSelf={{
                                "@initial": "flex-start",
                                "@sm": "center",
                              }}
                            >
                              {getFileSize(f.size)}
                            </Badge>
                          </Flex>
                        )}
                      </For>
                    </VStack>
                  </Box>
                </Show>
              </Box>
            )
          }}
        </For>
      </Show>
    </VStack>
  )
}

// ==================== Dedup 主页面 ====================

const Dedup: Component = () => {
  const t = useT()
  useManageTitle("manage.sidemenu.dedup")
  const [searchParams] = useSearchParams()

  const [path, setPath] = createSignal(searchParams.path ?? "/")
  const [concurrency, setConcurrency] = createSignal(3)
  const [qps, setQps] = createSignal(2.5)
  const [maxDepth, setMaxDepth] = createSignal(10)
  const [taskId, setTaskId] = createSignal(searchParams.task_id ?? "")
  const [taskStatus, setTaskStatus] = createSignal<DedupStatusResp>()
  const [activeTab, setActiveTab] = createSignal<
    "duplicates" | "candidates" | "folders"
  >("duplicates")
  const [selectedFolderPair, setSelectedFolderPair] =
    createSignal<DedupFolderPair | null>(null)
  const [mergeModalOpen, setMergeModalOpen] = createSignal(false)
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [starting, doStart] = useFetch(dedupStart)
  const [canceling, doCancel] = useFetch(dedupCancel)
  const [cleanPaths, setCleanPaths] = createSignal<string[]>([])
  const [cleanReclaimSize, setCleanReclaimSize] = createSignal(0)
  const [cleanModalOpen, setCleanModalOpen] = createSignal(false)
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [minSizeMB, setMinSizeMB] = createSignal(0)
  const [incExts, setIncExts] = createSignal("")
  const [excExts, setExcExts] = createSignal("")
  const [showAdv, setShowAdv] = createSignal(false)

  const isScanning = createMemo(() =>
    RUNNING_STATES.includes(taskStatus()?.state ?? ""),
  )
  const stats = createMemo(() => taskStatus()?.stats)

  let pollTimer: number | undefined
  const stopPoll = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
  onCleanup(stopPoll)

  const fetchStatus = async (tid: string) => {
    if (!tid) return
    const res = await dedupStatus(tid)
    handleResp(
      res,
      (data) => {
        setTaskStatus(data)
        if (!RUNNING_STATES.includes(data.state)) {
          stopPoll()
          setRefreshKey((k) => k + 1)
          if (data.state === "finished") {
            notify.success(
              t("dedup.scan.finished", {
                groups: data.stats.dup_groups,
                files: data.stats.dup_files,
              }),
            )
          } else if (data.state === "failed") {
            notify.error(data.error || t("dedup.state.failed"))
          }
        }
      },
      () => {
        stopPoll()
        if (localStorage.getItem("last_dedup_task_id") === tid) {
          localStorage.removeItem("last_dedup_task_id")
        }
      },
    )
  }

  const startPoll = (tid: string) => {
    stopPoll()
    pollTimer = window.setInterval(() => fetchStatus(tid), 1500)
  }

  const handleStartScan = async (silent = false) => {
    if (!path()) {
      notify.warning(t("dedup.scan.path_required"))
      return
    }
    const minSizeBytes = (minSizeMB() || 0) * 1024 * 1024
    const incList = incExts()
      ? incExts()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    const excList = excExts()
      ? excExts()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    const res = await doStart(
      path(),
      maxDepth(),
      concurrency(),
      qps(),
      minSizeBytes,
      incList,
      excList,
    )
    handleResp(
      res,
      (data) => {
        const tid = data.task_id || data.id
        setTaskId(tid)
        localStorage.setItem("last_dedup_task_id", tid)
        setTaskStatus(undefined)
        setActiveTab("duplicates")
        setRefreshKey((k) => k + 1)
        startPoll(tid)
        if (!silent) {
          notify.success(t("dedup.scan.started"))
        }
      },
      (err) => notify.error(err),
    )
  }

  let autoStarted = false
  createEffect(() => {
    const p = searchParams.path
    const auto = searchParams.auto
    if (!autoStarted && p && auto === "1") {
      autoStarted = true
      setPath(p)
      handleStartScan(true)
    }
  })

  // 页面初次加载时：探测正在运行的长任务或恢复上次查看的任务
  let autoResumed = false
  createEffect(async () => {
    if (autoResumed) return
    autoResumed = true

    if (!searchParams.task_id) {
      try {
        const res = await dedupStatus("")
        if (
          res.code === 200 &&
          res.data &&
          RUNNING_STATES.includes(res.data.state)
        ) {
          const tid = res.data.task_id || res.data.id
          if (tid) {
            setTaskId(tid)
            setTaskStatus(res.data)
            if (res.data.root_path) setPath(res.data.root_path)
            localStorage.setItem("last_dedup_task_id", tid)
            startPoll(tid)
            notify.info("检测到后台正在进行的扫描任务，已自动恢复进度看板")
            return
          }
        }
      } catch (e) {
        // ignore
      }

      const lastTid = localStorage.getItem("last_dedup_task_id")
      if (lastTid) {
        setTaskId(lastTid)
      }
    }
  })

  createEffect(() => {
    const tid = taskId()
    if (tid) {
      localStorage.setItem("last_dedup_task_id", tid)
      fetchStatus(tid)
      if (!pollTimer) {
        startPoll(tid)
      }
    }
  })

  return (
    <VStack w="$full" alignItems="stretch" spacing="$4">
      <HStack alignItems="center" spacing="$2">
        <Box as={BsSearch} boxSize="$6" color="$primary9" />
        <Heading size="lg">{t("dedup.title")}</Heading>
        <Spacer />
        <Button
          size="sm"
          variant="subtle"
          colorScheme="info"
          onClick={() => {
            setRefreshKey((k) => k + 1)
            setDrawerOpen(true)
          }}
        >
          {t("dedup.tabs.history")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<BsArrowRepeat />}
          onClick={() => {
            setRefreshKey((k) => k + 1)
            if (taskId()) fetchStatus(taskId())
          }}
        >
          {t("global.refresh")}
        </Button>
      </HStack>

      <Text fontSize="$sm" color="$neutral10">
        {t("dedup.desc")}
      </Text>

      {/* 扫描设置面板 */}
      <Show when={isScanning()}>
        <Box
          p="$3"
          rounded="$lg"
          bgColor="$info3"
          border="1px solid"
          borderColor="$info6"
        >
          <HStack spacing="$2" alignItems="center">
            <Spinner size="xs" color="$info10" />
            <Text fontSize="$xs" color="$info11" fontWeight="$medium">
              后台正在持续扫描目录 [{taskStatus()?.root_path || path()}]...
              退出浏览器或刷新页面不会中断任务。
            </Text>
          </HStack>
        </Box>
      </Show>

      <Box
        border="1px solid"
        borderColor="$neutral5"
        rounded="$lg"
        p="$4"
        bgColor="$neutral1"
      >
        <VStack alignItems="stretch" spacing="$3">
          <FormControl>
            <FormLabel>{t("dedup.scan.root")}</FormLabel>
            <FolderChooseInput
              value={path()}
              onChange={(p) => setPath(p)}
              onlyFolder={true}
            />
          </FormControl>

          <HStack spacing="$2_5" w="$full" alignItems="flex-end">
            <FormControl flex="1 1 80px" minW="80px">
              <FormLabel>{t("dedup.scan.concurrency")}</FormLabel>
              <Input
                type="number"
                min="1"
                max="8"
                value={concurrency()}
                onInput={(e: any) =>
                  setConcurrency(parseInt(e.currentTarget.value) || 1)
                }
              />
            </FormControl>
            <FormControl flex="1 1 80px" minW="80px">
              <FormLabel>{t("dedup.scan.qps")}</FormLabel>
              <Input
                type="number"
                min="0.1"
                max="200"
                step="0.1"
                value={qps()}
                onInput={(e: any) =>
                  setQps(parseFloat(e.currentTarget.value) || 0.1)
                }
              />
            </FormControl>
            <FormControl flex="1 1 80px" minW="80px">
              <FormLabel>{t("dedup.scan.max_depth")}</FormLabel>
              <Input
                type="number"
                min="1"
                max="64"
                value={maxDepth()}
                onInput={(e: any) =>
                  setMaxDepth(parseInt(e.currentTarget.value) || 1)
                }
              />
            </FormControl>
          </HStack>

          <HStack
            w="$full"
            mt="$2"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            gap="$2"
          >
            <Button
              size="sm"
              variant="ghost"
              colorScheme="neutral"
              onClick={() => setShowAdv((prev) => !prev)}
            >
              {showAdv() ? "收起高级过滤 ▲" : "高级过滤选项 ▼"}
            </Button>
            <HStack spacing="$2" alignItems="center">
              <Show when={isScanning()}>
                <Button
                  colorScheme="danger"
                  variant="subtle"
                  loading={canceling()}
                  onClick={async () => {
                    const res = await doCancel(taskId())
                    handleResp(res, () => fetchStatus(taskId()))
                  }}
                >
                  {t("dedup.scan.cancel")}
                </Button>
              </Show>
              <Button
                leftIcon={<BsSearch />}
                loading={starting()}
                disabled={isScanning()}
                onClick={() => handleStartScan()}
              >
                {t("dedup.scan.start")}
              </Button>
            </HStack>
          </HStack>

          <Show when={showAdv()}>
            <HStack
              spacing="$3"
              p="$3"
              rounded="$md"
              bgColor="$neutral2"
              border="1px dashed"
              borderColor="$neutral5"
              flexWrap="wrap"
              alignItems="flex-end"
            >
              <FormControl flex="1 1 100px" minW="90px">
                <FormLabel>最小文件大小 (MB)</FormLabel>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0 表示不限制"
                  value={minSizeMB()}
                  onInput={(e: any) =>
                    setMinSizeMB(parseFloat(e.currentTarget.value) || 0)
                  }
                />
              </FormControl>
              <FormControl flex="2 1 140px" minW="130px">
                <FormLabel>仅扫描后缀 (逗号分隔)</FormLabel>
                <Input
                  placeholder="如: mp4, mkv, iso"
                  value={incExts()}
                  onInput={(e: any) => setIncExts(e.currentTarget.value)}
                />
              </FormControl>
              <FormControl flex="2 1 140px" minW="130px">
                <FormLabel>排除后缀 (逗号分隔)</FormLabel>
                <Input
                  placeholder="如: tmp, log, bak"
                  value={excExts()}
                  onInput={(e: any) => setExcExts(e.currentTarget.value)}
                />
              </FormControl>
            </HStack>
          </Show>

          <FormHelperText>{t("dedup.scan.tips")}</FormHelperText>
        </VStack>
      </Box>

      {/* 实时进度看板 */}
      <Show when={taskStatus()}>
        <Box
          border="1px solid"
          borderColor="$neutral5"
          rounded="$lg"
          p="$4"
          bgColor="$neutral1"
        >
          <HStack spacing="$2" flexWrap="wrap">
            <Badge colorScheme={stateColor(taskStatus()!.state)}>
              {t(stateI18nKey(taskStatus()!.state))}
            </Badge>
            <Text fontSize="$sm" css={{ wordBreak: "break-all" }}>
              {taskStatus()!.root_path}
            </Text>
            <Spacer />
            <Text fontSize="$xs" color="$neutral10">
              {taskStatus()!.status}
            </Text>
          </HStack>

          <Box mt="$3">
            <TaskProgressBar
              progress={
                taskStatus()!.state === "finished"
                  ? 100
                  : taskStatus()!.progress
              }
              isIndeterminate={
                isScanning() &&
                (!taskStatus()!.progress || taskStatus()!.progress <= 0)
              }
              startTime={taskStatus()!.start_time}
              statusText={
                taskStatus()!.status ||
                (taskStatus()!.state === "finished" ? "扫描完成" : "扫描进行中")
              }
            />
          </Box>

          <HStack spacing="$3" mt="$3" flexWrap="wrap">
            <Text fontSize="$xs" color="$neutral11">
              {t("dedup.stats.scanned_dirs")}: {stats()?.scanned_dirs ?? 0}
            </Text>
            <Text fontSize="$xs" color="$neutral11">
              {t("dedup.stats.scanned_files")}: {stats()?.scanned_files ?? 0}
            </Text>
            <Text fontSize="$xs" color="$success11">
              {t("dedup.stats.verified")}: {stats()?.verified_files ?? 0}
            </Text>
            <Text fontSize="$xs" color="$warning11">
              {t("dedup.stats.unverified")}: {stats()?.unverified_files ?? 0}
            </Text>
            <Text fontSize="$xs" color="$danger9">
              {t("dedup.stats.dup_groups")}: {stats()?.dup_groups ?? 0} ·{" "}
              {t("dedup.stats.wasted")}:{" "}
              {getFileSize(stats()?.wasted_bytes ?? 0)}
            </Text>
            <Show when={(stats()?.failed_dirs ?? 0) > 0}>
              <Text fontSize="$xs" color="$warning11">
                {t("dedup.stats.failed_dirs")}: {stats()?.failed_dirs}
              </Text>
            </Show>
          </HStack>

          <Show when={(stats()?.unverified_files ?? 0) > 0}>
            <Box mt="$3" p="$2" rounded="$md" bgColor="$warning3">
              <Text fontSize="$xs" color="$warning11">
                {t("dedup.scan.no_hash_hint", {
                  count: stats()?.unverified_files ?? 0,
                })}
              </Text>
            </Box>
          </Show>
        </Box>
      </Show>

      {/* 重复文件结果看板 */}
      <Show
        when={taskId()}
        fallback={
          <Box
            p="$8"
            textAlign="center"
            rounded="$lg"
            bgColor="$neutral2"
            color="$neutral10"
          >
            {t("dedup.result.no_task")}
          </Box>
        }
      >
        <Show
          when={!isScanning()}
          fallback={
            <Box
              p="$8"
              textAlign="center"
              rounded="$lg"
              bgColor="$neutral2"
              color="$neutral10"
            >
              {t("dedup.result.scanning")}
            </Box>
          }
        >
          <HStack spacing="$2" flexWrap="wrap">
            <Button
              size="sm"
              variant={activeTab() === "duplicates" ? "solid" : "subtle"}
              colorScheme="accent"
              onClick={() => setActiveTab("duplicates")}
            >
              {t("dedup.tabs.duplicates")} (
              {taskStatus()?.stats.dup_groups ?? 0})
            </Button>
            <Button
              size="sm"
              variant={activeTab() === "candidates" ? "solid" : "subtle"}
              colorScheme="warning"
              onClick={() => setActiveTab("candidates")}
            >
              {t("dedup.tabs.candidates")} (
              {taskStatus()?.stats.candidate_groups ?? 0})
            </Button>
            <Button
              size="sm"
              variant={activeTab() === "folders" ? "solid" : "subtle"}
              colorScheme="accent"
              onClick={() => setActiveTab("folders")}
            >
              📁 {t("dedup.tabs.folders")}
            </Button>
          </HStack>

          <Show when={activeTab() === "duplicates"}>
            <ResultList
              taskId={taskId()}
              verified={true}
              refreshKey={refreshKey()}
              onRequestClean={(paths, size) => {
                setCleanPaths(paths)
                setCleanReclaimSize(size)
                setCleanModalOpen(true)
              }}
            />
          </Show>

          <Show when={activeTab() === "candidates"}>
            <Box p="$3" rounded="$md" bgColor="$warning3">
              <Text fontSize="$xs" color="$warning11">
                {t("dedup.result.candidate_warning")}
              </Text>
            </Box>
            <ResultList
              taskId={taskId()}
              verified={false}
              refreshKey={refreshKey()}
              onRequestClean={() => {}}
            />
          </Show>

          <Show when={activeTab() === "folders"}>
            <FolderPairList
              taskId={taskId()}
              refreshKey={refreshKey()}
              onOpenMerge={(pair) => {
                setSelectedFolderPair(pair)
                setMergeModalOpen(true)
              }}
            />
          </Show>
        </Show>
      </Show>

      {/* 历史任务抽屉 */}
      <Drawer
        opened={drawerOpen()}
        placement="right"
        size="lg"
        onClose={() => setDrawerOpen(false)}
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader>{t("dedup.tabs.history") || "历史任务"}</DrawerHeader>
          <DrawerBody p="$3">
            <HistoryDrawerContent
              refreshKey={refreshKey()}
              onDeleted={() => setRefreshKey((k) => k + 1)}
              onSelect={(item) => {
                setTaskId(item.id)
                setActiveTab("duplicates")
                setDrawerOpen(false)
                setRefreshKey((k) => k + 1)
                fetchStatus(item.id)
              }}
              onReuse={(item) => {
                setPath(item.root_path ?? "/")
                setConcurrency(item.concurrency || 3)
                setQps(item.qps || 2.5)
                setMaxDepth(item.max_depth || 10)
                setMinSizeMB(
                  item.min_size ? Math.round(item.min_size / (1024 * 1024)) : 0,
                )
                setIncExts(item.include_exts || "")
                setExcExts(item.exclude_exts || "")
                if (item.min_size || item.include_exts || item.exclude_exts) {
                  setShowAdv(true)
                }
                setDrawerOpen(false)
                notify.success(`已复用任务 [${item.root_path}] 的扫描配置`)
              }}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* 清理确认弹窗 */}
      <CleanModal
        taskId={taskId()}
        paths={cleanPaths()}
        reclaimSize={cleanReclaimSize()}
        opened={cleanModalOpen()}
        onClose={() => setCleanModalOpen(false)}
        onDone={() => {
          setRefreshKey((k) => k + 1)
          if (taskId()) fetchStatus(taskId())
        }}
      />

      {/* 重复文件夹合并确认弹窗 */}
      <MergeFoldersModal
        taskId={taskId()}
        pair={selectedFolderPair()}
        opened={mergeModalOpen()}
        onClose={() => setMergeModalOpen(false)}
        onDone={() => {
          setRefreshKey((k) => k + 1)
          if (taskId()) fetchStatus(taskId())
        }}
      />
    </VStack>
  )
}

export default Dedup
