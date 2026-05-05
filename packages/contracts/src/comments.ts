// Comment / pin persistence wire format.
//
// 用户在预览里点 Comment 工具放钉子。每个 pin 有 viewport 坐标 (x, y)、
// 1-based 显示序号 n、自由文本，以及可选的 CSS selector（指向被评论的元素）。
//
// id 由客户端生成（crypto.randomUUID）：optimistic dispatch + fire-and-forget
// POST 时 client/server id 一致，避免 reconcile。
//
// 删除按 id（不按 n —— n 在删除后会不连续，不能当 PK）。

export interface Comment {
  id: string;
  projectId: string;
  n: number;
  x: number;
  y: number;
  text: string;
  selector?: string | null;
  /** Path of the artifact file the pin was dropped on (optional). */
  filePath?: string | null;
  createdAt: string;
}

export interface ListCommentsResponse {
  comments: Comment[];
}

export interface CreateCommentRequest {
  /** Client-generated UUID — server uses it as-is so optimistic UI works. */
  id: string;
  n: number;
  x: number;
  y: number;
  text: string;
  selector?: string;
  /** Active file path when the pin was dropped (optional). */
  filePath?: string;
}

export interface CreateCommentResponse {
  comment: Comment;
}
