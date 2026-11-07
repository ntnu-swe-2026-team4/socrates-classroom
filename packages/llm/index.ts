// 後端只 import 這個檔（Workers 上 import 打包出來的 dist/worker.ts）
//   const report = await llm.classReport({ title, statement, students, locale });
//   const summary = await llm.studentReport({ title, statement, transcript, locale });
import { defineTasks } from "./runtime/define.ts";
import { createLLM, type InputOf, type OutputOf } from "./runtime/llm.ts";

import classReport from "./tasks/class-report/task.ts";
import studentReport from "./tasks/student-report/task.ts";

/** 正式任務；名稱 = tasks/ 底下的資料夾名稱 */
export const tasks = defineTasks("tasks", {
  "class-report": classReport,
  "student-report": studentReport,
});

/** 後端呼叫的 AI 功能：名稱轉成駝峰，例："class-report" → llm.classReport */
export const llm = createLLM(tasks);

export { LLMError, type LLMErrorCode } from "./runtime/errors.ts";
export type { Answer, RunOptions } from "./runtime/oneshot.ts";
export type { ConnectionSettings } from "./runtime/config.ts";

type Tasks = typeof tasks;
/** 輸入型別，例：Input<"class-report"> */
export type Input<K extends keyof Tasks> = InputOf<Tasks[K]>;
/** 輸出型別 */
export type Output<K extends keyof Tasks> = OutputOf<Tasks[K]>;
