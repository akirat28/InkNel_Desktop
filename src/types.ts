/**
 * メモファイルのメタ情報。
 *
 * 実体ファイルはディレクトリ分けせず保存先にフラット配置し、
 * ディレクトリ階層は `folder` フィールドで仮想的に管理する。
 *
 * NoteMeta（global.d.ts）の構造的サブセット。Sidebar 等は FileItem として
 * 受けるが、実体は NoteMeta が渡されるので追加フィールドにもアクセス可能。
 */
export interface FileItem {
  id: string;
  title: string;
  /** スラッシュ区切りの仮想フォルダパス。空文字列はルート。例: "work/projects" */
  folder: string;
  /** 保護フラグ（誤削除防止） */
  protected?: boolean;
  /** シークレットフラグ（クリック時にもパスワード要求） */
  secret?: boolean;
  /** このノートから連携しているノートID一覧 */
  linkedNoteIds?: string[];
  /** サイドバーアイコンの色 (CSS 色文字列、null = 色なし) */
  iconColor?: string | null;
}

export interface TreeFolderNode {
  kind: 'folder';
  /** このフォルダ階層単独の名前（"projects"） */
  name: string;
  /** ルートからのフルパス（"work/projects"） */
  path: string;
  children: TreeNode[];
}

export interface TreeFileNode {
  kind: 'file';
  file: FileItem;
}

export type TreeNode = TreeFolderNode | TreeFileNode;
