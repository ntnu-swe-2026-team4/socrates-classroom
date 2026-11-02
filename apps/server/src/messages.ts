import type { Lang } from "@socrates/shared";

type Vars = Record<string, string | number>;
type Entry = { zh: string; en: string; es: string };

/**
 * 給使用者看的訊息（錯誤、系統訊息）。資料本身不翻譯。
 * 以 zh 為預設；en / es 缺漏時退回中文。
 */
const M: Record<string, Entry> = {
  unauthorized: { zh: "請先登入。", en: "Please sign in first.", es: "Inicia sesión primero." },
  forbidden: { zh: "你沒有權限執行這個動作。", en: "You are not allowed to do that.", es: "No tienes permiso para hacer eso." },
  not_found: { zh: "找不到資料。", en: "Not found.", es: "No encontrado." },
  conflict: { zh: "這個動作和目前的狀態衝突。", en: "That conflicts with the current state.", es: "Eso entra en conflicto con el estado actual." },
  validation: { zh: "送出的資料不正確。", en: "The submitted data is invalid.", es: "Los datos enviados no son válidos." },
  internal_error: { zh: "伺服器發生錯誤，請稍後再試。", en: "Something went wrong on the server. Please try again.", es: "Algo falló en el servidor. Inténtalo de nuevo." },
  rate_limited: { zh: "送得太頻繁了，請稍後再試。", en: "Too many requests. Please slow down.", es: "Demasiadas solicitudes. Espera un momento." },
  already_streaming: { zh: "蘇格拉底還在回應上一句，請稍等。", en: "Socrates is still replying. Please wait.", es: "Sócrates todavía está respondiendo. Espera un momento." },
  invalid_role: { zh: "身分必須是學生或老師。", en: "Role must be student or teacher.", es: "El rol debe ser estudiante o profesor." },
  name_required: { zh: "名稱不能是空的。", en: "Name cannot be empty.", es: "El nombre no puede estar vacío." },
  avatar_too_large: { zh: "頭像檔案太大（上限 200 KB）。", en: "Avatar is too large (200 KB maximum).", es: "El avatar es demasiado grande (máximo 200 KB)." },
  avatar_invalid: { zh: "頭像必須是圖片。", en: "Avatar must be an image.", es: "El avatar debe ser una imagen." },

  archive_not_found: { zh: "找不到這個議題。", en: "Topic not found.", es: "Tema no encontrado." },
  archive_not_owner: { zh: "這不是你的議題。", en: "This topic is not yours.", es: "Este tema no es tuyo." },
  cannot_reshare: { zh: "別人分享給你的題目不能再轉分享。", en: "A topic shared with you cannot be reshared.", es: "Un tema compartido contigo no se puede volver a compartir." },
  unknown_share_target: { zh: "找不到要分享的對象。", en: "One of the share targets was not found.", es: "No se encontró uno de los destinatarios." },
  archive_title_required: { zh: "請填寫議題標題。", en: "Please enter a topic title.", es: "Escribe un título para el tema." },

  classroom_not_found: { zh: "找不到這間教室。", en: "Classroom not found.", es: "Aula no encontrada." },
  not_classroom_member: { zh: "你不是這間教室的成員。", en: "You are not a member of this classroom.", es: "No eres miembro de esta aula." },
  only_teacher: { zh: "只有老師可以這樣做。", en: "Only the teacher can do that.", es: "Solo el profesor puede hacer eso." },
  only_staff: { zh: "只有老師或助教可以這樣做。", en: "Only the teacher or an assistant can do that.", es: "Solo el profesor o un asistente puede hacer eso." },
  only_student: { zh: "只有學生可以這樣做。", en: "Only students can do that.", es: "Solo los estudiantes pueden hacer eso." },
  classroom_name_required: { zh: "教室名稱不能是空的。", en: "Classroom name cannot be empty.", es: "El nombre del aula no puede estar vacío." },
  member_not_found: { zh: "找不到這位成員。", en: "Member not found.", es: "Miembro no encontrado." },
  member_exists: { zh: "這位成員已經在教室裡。", en: "That member is already in the classroom.", es: "Ese miembro ya está en el aula." },
  member_in_classroom_load_failed: { zh: "讀取成員失敗。", en: "Could not load members.", es: "No se pudieron cargar los miembros." },
  invalid_member_role: { zh: "成員身分只能是學生或助教。", en: "Member role must be student or assistant.", es: "El rol debe ser estudiante o asistente." },
  invite_not_found: { zh: "找不到這筆邀請。", en: "Invitation not found.", es: "Invitación no encontrada." },

  join_code_invalid: { zh: "邀請碼無效或已停用，請向老師確認。", en: "That join code is invalid or disabled.", es: "El código no es válido o está desactivado." },
  join_code_required: { zh: "需要有效的邀請碼才能加入這間教室。", en: "A valid join code is required for this classroom.", es: "Se necesita un código válido para entrar a esta aula." },
  already_member: { zh: "你已經是這間教室的成員。", en: "You are already a member of this classroom.", es: "Ya eres miembro de esta aula." },
  pending_application: { zh: "你已經送出申請，請等老師審核。", en: "You already applied. Please wait for review.", es: "Ya enviaste una solicitud. Espera la revisión." },
  application_not_found: { zh: "找不到這筆申請。", en: "Application not found.", es: "Solicitud no encontrada." },
  application_reviewed: { zh: "這筆申請已經審核過了。", en: "That application has already been reviewed.", es: "Esa solicitud ya fue revisada." },
  cancel_pending_only: { zh: "只能取消自己還在審核中的申請。", en: "You can only cancel your own pending application.", es: "Solo puedes cancelar tu solicitud pendiente." },
  question_required: { zh: "請回答「{prompt}」。", en: "Please answer \"{prompt}\".", es: "Responde \"{prompt}\"." },
  choice_invalid: { zh: "「{prompt}」的選項不正確。", en: "Invalid choice for \"{prompt}\".", es: "Opción no válida para \"{prompt}\"." },
  question_prompt_required: { zh: "每一題都要有題目。", en: "Every question needs a prompt.", es: "Cada pregunta necesita un enunciado." },
  choice_options_required: { zh: "「{prompt}」至少要有兩個選項。", en: "\"{prompt}\" needs at least two options.", es: "\"{prompt}\" necesita al menos dos opciones." },

  announcement_not_found: { zh: "找不到這則公告。", en: "Announcement not found.", es: "Anuncio no encontrado." },
  announcement_title_required: { zh: "請填寫公告標題。", en: "Please enter an announcement title.", es: "Escribe un título para el anuncio." },

  topic_not_found: { zh: "找不到這場辯論。", en: "Debate not found.", es: "Debate no encontrado." },
  topic_title_required: { zh: "請填寫辯論主題。", en: "Please enter a debate title.", es: "Escribe un título para el debate." },
  activity_settings_required: { zh: "建立辯論時需要辯論設定。", en: "Debate settings are required when creating a debate.", es: "La configuración del debate es obligatoria al crearlo." },
  settings_locked: { zh: "已經有學生開始對話，辯論設定不能再修改。", en: "Students have started the dialogue, so the settings can no longer be changed.", es: "Los estudiantes ya empezaron el diálogo; la configuración ya no se puede cambiar." },
  invalid_axis: { zh: "價值軸的格式不正確。", en: "Invalid value axis.", es: "Eje de valor no válido." },
  invalid_group_size: { zh: "組別人數要在 2 到 8 之間。", en: "Group size must be between 2 and 8.", es: "El tamaño del grupo debe estar entre 2 y 8." },
  invalid_answer_mode: { zh: "回答方式必須是文字、語音或兩者。", en: "Answer mode must be text, voice, or both.", es: "El modo debe ser texto, voz o ambos." },
  link_invalid: { zh: "連結要以 http:// 或 https:// 開頭。", en: "Links must start with http:// or https://.", es: "El enlace debe empezar con http:// o https://." },
  resource_not_found: { zh: "找不到這份資料。", en: "Resource not found.", es: "Recurso no encontrado." },
  report_not_found: { zh: "找不到這份報告。", en: "Report not found.", es: "Informe no encontrado." },
  reports_disabled: { zh: "這場辯論沒有開放上傳報告。", en: "This debate does not accept reports.", es: "Este debate no acepta informes." },
  file_too_large: { zh: "檔案太大（上限 50 MB）。", en: "File is too large (50 MB maximum).", es: "El archivo es demasiado grande (máximo 50 MB)." },
  file_missing: { zh: "請選擇檔案。", en: "Please choose a file.", es: "Elige un archivo." },
  file_not_found: { zh: "找不到檔案。", en: "File not found.", es: "Archivo no encontrado." },

  post_not_found: { zh: "找不到這則貼文。", en: "Post not found.", es: "Publicación no encontrada." },
  post_empty: { zh: "內容不能是空的。", en: "The post cannot be empty.", es: "La publicación no puede estar vacía." },
  post_too_long: { zh: "內容最多 2000 字。", en: "Posts are limited to 2000 characters.", es: "Las publicaciones tienen un máximo de 2000 caracteres." },
  reply_scope: { zh: "只能回覆同一個討論區的主貼文。", en: "You can only reply to a top-level post in the same discussion.", es: "Solo puedes responder a una publicación principal del mismo debate." },

  discussion_not_found: { zh: "找不到這個討論。", en: "Discussion not found.", es: "Discusión no encontrada." },
  discussion_title_required: { zh: "請填寫討論題目。", en: "Please enter a discussion title.", es: "Escribe un título para la discusión." },
  max_rounds: { zh: "對話輪數上限要在 2 到 40 之間。", en: "The round limit must be between 2 and 40.", es: "El límite de turnos debe estar entre 2 y 40." },
  discussion_closed: { zh: "這個討論已經結束了。", en: "This discussion is closed.", es: "Esta discusión está cerrada." },
  max_rounds_reached: { zh: "已達這個討論的最多 {n} 輪。", en: "You reached the limit of {n} rounds.", es: "Alcanzaste el límite de {n} turnos." },
  conclusion_empty: { zh: "結論不能是空的。", en: "The conclusion cannot be empty.", es: "La conclusión no puede estar vacía." },
  need_dialogue: { zh: "先跟蘇格拉底聊過，再送出結論。", en: "Talk with Socrates before submitting a conclusion.", es: "Habla con Sócrates antes de enviar una conclusión." },
  session_not_found: { zh: "找不到這位同學的討論。", en: "That student's discussion was not found.", es: "No se encontró la discusión de ese estudiante." },

  activity_not_found: { zh: "找不到這個活動。", en: "Activity not found.", es: "Actividad no encontrada." },
  stage_done: { zh: "活動已經結束。", en: "The activity is already finished.", es: "La actividad ya terminó." },
  stage_not_individual: { zh: "個人調查已經結束。", en: "The individual stage is over.", es: "La etapa individual ya terminó." },
  stage_not_team: { zh: "目前不在團隊提純階段。", en: "The team stage is not active.", es: "La etapa de equipo no está activa." },
  stage_not_debate: { zh: "目前不在辯論比賽階段。", en: "The debate stage is not active.", es: "La etapa de debate no está activa." },
  cannot_advance: { zh: "目前的階段不能再往下推進。", en: "The activity cannot advance from this stage.", es: "La actividad no puede avanzar desde esta etapa." },
  need_two_groups: { zh: "至少需要兩個組別才能辯論。", en: "At least two groups are needed for a debate.", es: "Se necesitan al menos dos grupos para debatir." },
  deadline_in_past: { zh: "截止時間要晚於現在。", en: "The deadline must be in the future.", es: "La fecha límite debe ser futura." },
  not_ready_stage: { zh: "這個階段不需要回報準備好了。", en: "This stage does not use readiness.", es: "Esta etapa no usa el estado de preparación." },
  group_not_found: { zh: "找不到組別。", en: "Group not found.", es: "Grupo no encontrado." },
  not_your_group: { zh: "只能在自己的組別發言。", en: "You can only speak in your own group.", es: "Solo puedes hablar en tu propio grupo." },
  argument_not_found: { zh: "找不到論點。", en: "Argument not found.", es: "Argumento no encontrado." },
  no_arguments: { zh: "先請 AI 整理論點，才有東西可以丟反例。", en: "Summarize the arguments first.", es: "Primero resume los argumentos." },
  all_countered: { zh: "每一條主張都丟過反例了。", en: "Every claim already has a counterexample.", es: "Cada afirmación ya tiene un contraejemplo." },
  no_split: { zh: "目前沒有需要分裂的分歧。", en: "There is no disagreement to split on right now.", es: "Ahora no hay desacuerdo para dividir." },
  room_not_found: { zh: "找不到場次。", en: "Room not found.", es: "Sala no encontrada." },
  room_not_live: { zh: "這場比賽不在進行中。", en: "This room is not live.", es: "Esta sala no está en vivo." },
  not_your_turn: { zh: "還沒輪到你。", en: "It is not your turn yet.", es: "Todavía no es tu turno." },
  judgment_not_found: { zh: "找不到評分。", en: "Judgment not found.", es: "Evaluación no encontrada." },
  score_not_found: { zh: "還沒有成績。", en: "No scores yet.", es: "Aún no hay puntuaciones." },
  star_after_done: { zh: "立場星圖在活動結束後才會公開。", en: "The star map opens when the activity ends.", es: "El mapa estelar se abre al terminar la actividad." },
  note_not_found: { zh: "找不到筆記。", en: "Note not found.", es: "Nota no encontrada." },
  note_empty: { zh: "筆記不能是空的。", en: "A note cannot be empty.", es: "Una nota no puede estar vacía." },
  position_locked: { zh: "個人調查結束後不能再修改論點。", en: "The position can no longer be changed after the individual stage.", es: "La posición ya no se puede cambiar después de la etapa individual." },
  calendar_not_found: { zh: "找不到行事曆事件。", en: "Calendar event not found.", es: "Evento de calendario no encontrado." },
  invalid_datetime: { zh: "請選擇有效的日期與時間。", en: "Please choose a valid date and time.", es: "Elige una fecha y hora válidas." },
  event_title_required: { zh: "請填寫事件標題。", en: "Please enter an event title.", es: "Escribe un título para el evento." },
  custom_only: { zh: "系統事件不能直接修改。", en: "System events cannot be edited directly.", es: "Los eventos del sistema no se pueden editar directamente." },

  text_required: { zh: "請輸入內容。", en: "Please enter some text.", es: "Escribe algo." },
  text_too_long: { zh: "內容最多 {n} 字。", en: "Text is limited to {n} characters.", es: "El texto tiene un máximo de {n} caracteres." },
  invalid_request: { zh: "請求格式不正確。", en: "Invalid request.", es: "Solicitud no válida." },

  llm_not_configured: { zh: "蘇格拉底暫時無法回應，請稍後再試。", en: "Socrates cannot reply right now. Please try again later.", es: "Sócrates no puede responder ahora. Inténtalo más tarde." },
  llm_unavailable: { zh: "蘇格拉底暫時無法回應，請稍後再試。", en: "Socrates cannot reply right now. Please try again later.", es: "Sócrates no puede responder ahora. Inténtalo más tarde." },
  llm_rate_limited: { zh: "現在太多人同時在問蘇格拉底，請稍後再試。", en: "Socrates is busy right now. Please try again shortly.", es: "Sócrates está ocupado. Inténtalo en un momento." },
  llm_timeout: { zh: "蘇格拉底想太久了，請再送一次。", en: "Socrates took too long. Please try again.", es: "Sócrates tardó demasiado. Inténtalo de nuevo." },
  llm_error: { zh: "蘇格拉底暫時無法回應，請稍後再試。", en: "Socrates cannot reply right now. Please try again later.", es: "Sócrates no puede responder ahora. Inténtalo más tarde." },
};

export function languageOf(header: string | null | undefined): Lang {
  const first = (header ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  if (first.startsWith("es")) return "es";
  return "zh";
}

export function msg(lang: Lang, key: string, vars: Vars = {}): string {
  const entry = M[key] ?? M.internal_error;
  const template = entry[lang] || entry.zh;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function hasMessage(key: string): boolean {
  return key in M;
}
