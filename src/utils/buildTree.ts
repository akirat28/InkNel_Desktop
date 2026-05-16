import type { FileItem, TreeFolderNode, TreeNode } from '../types';

/**
 * フラットなファイル配列から、ディレクトリ階層を表すツリーを構築する。
 * 各 FileItem の `folder` フィールド（"a/b/c" 形式）を基に階層を組み立てる。
 *
 * `extraFolders` を渡すと、ノートが1つも入っていない空フォルダも
 * ツリーに追加される。これにより明示的に作成された空フォルダを表示できる。
 *
 * - 同じ階層のフォルダ同士・ファイル同士はタイトル昇順でソート
 * - フォルダはファイルより上に表示
 */
export function buildTree(
  files: FileItem[],
  extraFolders: string[] = [],
): TreeNode[] {
  const root: TreeFolderNode = {
    kind: 'folder',
    name: '',
    path: '',
    children: [],
  };

  // パスごとのフォルダノードを高速参照するためのインデックス
  const folderIndex = new Map<string, TreeFolderNode>();
  folderIndex.set('', root);

  /** "a/b/c" を root から辿り、必要なら作成して末端を返す。 */
  const ensureFolder = (path: string): TreeFolderNode => {
    const segments = path
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let parent = root;
    let cumulativePath = '';

    for (const seg of segments) {
      cumulativePath = cumulativePath ? `${cumulativePath}/${seg}` : seg;
      let folder = folderIndex.get(cumulativePath);
      if (!folder) {
        folder = {
          kind: 'folder',
          name: seg,
          path: cumulativePath,
          children: [],
        };
        folderIndex.set(cumulativePath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }

    return parent;
  };

  // 1) 明示的な空フォルダを先に作っておく
  for (const path of extraFolders) {
    ensureFolder(path);
  }

  // 2) ノートを所属フォルダ配下に配置
  for (const file of files) {
    const parent = ensureFolder(file.folder);
    parent.children.push({ kind: 'file', file });
  }

  sortTree(root);
  return root.children;
}

function sortTree(node: TreeFolderNode): void {
  node.children.sort((a, b) => {
    // フォルダを先に
    if (a.kind !== b.kind) {
      return a.kind === 'folder' ? -1 : 1;
    }
    const aName = a.kind === 'folder' ? a.name : a.file.title;
    const bName = b.kind === 'folder' ? b.name : b.file.title;
    return aName.localeCompare(bName, 'ja');
  });

  for (const child of node.children) {
    if (child.kind === 'folder') {
      sortTree(child);
    }
  }
}
