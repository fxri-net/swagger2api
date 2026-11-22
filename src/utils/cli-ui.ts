import { checkbox, confirm, input, number, select } from "@inquirer/prompts"

// 统一交互封装：所有提问走 @inquirer/prompts，ESC / Ctrl+C 统一转成 PromptCancelled，
// 由命令层决定退出码（生成选择为 130），其余异常原样抛出。

/** 交互取消（ESC / Ctrl+C） */
export class PromptCancelled extends Error {
  constructor() {
    super("用户取消交互")
    this.name = "PromptCancelled"
  }
}

/**
 * 识别取消异常：inquirer 以 ExitPromptError / AbortPromptError 抛出。
 * @param error 捕获的异常
 * @return 不返回（取消时抛 PromptCancelled，其余原样抛出）
 */
function rethrow(error: unknown): never {
  if (error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name)) throw new PromptCancelled()
  throw error
}

/** 文本输入 */
export async function askText(message: string, defaultValue = ""): Promise<string> {
  try {
    return await input({ message, default: defaultValue })
  } catch (error) {
    return rethrow(error)
  }
}

/** 数字输入 */
export async function askNumber(message: string, defaultValue = 0): Promise<number> {
  try {
    return await number({ message, default: defaultValue, required: true })
  } catch (error) {
    return rethrow(error)
  }
}

/** 单选 */
export async function askSelect<T extends string>(message: string, choices: Array<{ label: string; value: T }>, defaultValue: T): Promise<T> {
  try {
    return await select({ message, choices, default: defaultValue })
  } catch (error) {
    return rethrow(error)
  }
}

/** 是 / 否确认 */
export async function askConfirm(message: string, defaultValue = false): Promise<boolean> {
  try {
    return await confirm({ message, default: defaultValue })
  } catch (error) {
    return rethrow(error)
  }
}

/** 多选选项 */
export interface CheckboxChoice<T extends string = string> {
  /** 展示文本 */
  label: string
  /** 选项值 */
  value: T
  /** 补充说明 */
  description?: string
}

/**
 * 多选：允许空选，默认全不选。
 * @param message 提示文案
 * @param choices 选项
 * @param pageSize 一页展示数量
 * @return 选中的值
 */
export async function askCheckbox<T extends string>(message: string, choices: Array<CheckboxChoice<T>>, pageSize = 10): Promise<T[]> {
  try {
    return await checkbox({ message, choices, required: false, pageSize })
  } catch (error) {
    return rethrow(error)
  }
}
