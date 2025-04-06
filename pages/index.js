import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow as syntaxStyle } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * 将 GitHub API 返回的平面列表构建为嵌套的树形结构
 * @param {Array} flatList GitHub API 返回的数组，每项代表文件或目录对象
 * @returns {Array} 嵌套的树形结构数据
 */
function buildTree(flatList) {
  const tree = [];
  const map = {};
  flatList.forEach((item) => {
    item.children = [];
    map[item.path] = item;
    if (!item.path.includes('/')) {
      tree.push(item);
    } else {
      const parts = item.path.split('/');
      parts.pop(); // 删除当前节点名称
      const parentPath = parts.join('/');
      if (map[parentPath]) {
        map[parentPath].children.push(item);
      } else {
        // 找不到父节点的归为顶级（异常数据）
        tree.push(item);
      }
    }
  });
  return tree;
}

/**
 * 递归组件：展示文件夹／文件节点
 * Props:
 *   node：节点数据
 *   onFileSelect：点击文件时的回调
 *   initialPath：初始展开的目录（仓库根后的路径，如 "test"）
 *   selectedPath：当前选中文件完整路径
 */
function TreeNode({ node, onFileSelect, initialPath, selectedPath }) {
  const shouldExpand =
    initialPath &&
    node.type === 'tree' &&
    (initialPath === node.path || initialPath.startsWith(node.path + '/'));
  const [expanded, setExpanded] = useState(!!shouldExpand);
  const isHighlighted = node.type === 'tree' && initialPath === node.path;
  const isSelected = node.type === 'blob' && selectedPath === node.path;

  const handleClick = () => {
    if (node.type === 'tree') {
      setExpanded(!expanded);
    } else if (node.type === 'blob') {
      onFileSelect && onFileSelect(node);
    }
  };

  return (
    <div className="tree-node">
      <div
        onClick={handleClick}
        className={`node-label ${isSelected ? 'selected' : ''}`}
      >
        {node.children && node.children.length > 0
          ? expanded
            ? '[-] '
            : '[+] '
          : '    '}
        {node.type === 'tree' ? '📁' : '📄'} {node.path.split('/').pop()}
      </div>
      {expanded &&
        node.children &&
        node.children
          .sort((a, b) => {
            if (a.type === b.type) return a.path.localeCompare(b.path);
            return a.type === 'tree' ? -1 : 1;
          })
          .map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onFileSelect={onFileSelect}
              initialPath={initialPath}
              selectedPath={selectedPath}
            />
          ))}
    </div>
  );
}

/**
 * 主页面组件
 * Props:
 *   treeData：仓库文件树数据
 *   owner、repo、defaultBranch：仓库基本信息
 *   initialPath：配置的初始展开目录（仓库根后路径）
 *   error：错误信息（如有）
 */
export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  // 用于预览、文件选择
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState('');
  const [previewMeta, setPreviewMeta] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);

  // 编辑相关状态
  const [isEditing, setIsEditing] = useState(false);
  const [editorMode, setEditorMode] = useState("source"); // "source" 或 "visual"
  const [editContent, setEditContent] = useState("");
  const [fileSha, setFileSha] = useState(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const visualRef = useRef(null);

  // 调整左侧面板宽度
  const handleMouseDown = (e) => {
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMouseMove = (e) => {
      const delta = e.clientX - startX;
      setLeftPanelWidth(Math.max(150, startWidth + delta));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  /**
   * 预览模式：调用 /api/preview 获取文件内容
   */
  const handleFileSelect = async (file) => {
    if (file.type !== 'blob') return;
    setSelectedPath(file.path);
    setLoadingPreview(true);
    setPreview('');
    setPreviewMeta(null);
    try {
      const res = await fetch(
        `/api/preview?path=${encodeURIComponent(file.path)}&ref=${defaultBranch}`
      );
      if (!res.ok) {
        const errText = await res.text();
        setPreview(`Error: ${errText}`);
      } else {
        const data = await res.json();
        setPreview(data.content);
        setPreviewMeta(data);
      }
    } catch (e) {
      setPreview(`Error: ${e.message}`);
    }
    setLoadingPreview(false);
    setIsEditing(false);
  };

  /**
   * 进入编辑模式：调用 /api/preview?edit=true 请求获取文件的最新内容及 SHA
   */
  const handleEdit = async () => {
    if (!selectedPath) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(
        `/api/preview?edit=true&path=${encodeURIComponent(selectedPath)}&ref=${defaultBranch}`
      );
      if (!res.ok) {
        const errText = await res.text();
        alert("获取编辑内容失败：" + errText);
        setLoadingPreview(false);
        return;
      }
      const data = await res.json();
      if (data.isBinary || data.isImage) {
        alert("选中的文件不可编辑");
        setLoadingPreview(false);
        return;
      }
      setEditContent(data.content);
      setFileSha(data.sha);
      setIsEditing(true);
      setEditorMode("source");
    } catch (e) {
      alert("Error: " + e.message);
    }
    setLoadingPreview(false);
  };

  /**
   * 切换编辑模式：源代码编辑 与 所见即所得
   */
  const toggleEditorMode = () => {
    if (editorMode === "source") {
      // 切换到所见即所得：通过 marked 将 markdown 转为 HTML
      setEditorMode("visual");
    } else {
      // 切换到源代码编辑：利用 Turndown 将 visual 编辑区内容转回 Markdown
      if (visualRef.current) {
        const tdService = new TurndownService();
        const markdown = tdService.turndown(visualRef.current.innerHTML);
        setEditContent(markdown);
      }
      setEditorMode("source");
    }
  };

  /**
   * 提交修改：调用 /api/save 提交更新后的内容
   */
  const handleCommit = async () => {
    if (!commitMsg) {
      alert("请输入提交信息");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          message: commitMsg,
          content: editContent,
          sha: fileSha,
          branch: defaultBranch
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert("提交失败：" + errText);
      } else {
        alert("提交成功！");
        setIsEditing(false);
        // 刷新预览内容
        handleFileSelect({ path: selectedPath, type: "blob" });
      }
    } catch (e) {
      alert("提交异常: " + e.message);
    }
    setSaving(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent("");
    setCommitMsg("");
    setFileSha(null);
  };

  // 仅对预览内容是文本时，允许进入编辑模式
  const canEdit =
    previewMeta &&
    !previewMeta.isBinary &&
    !previewMeta.isImage;

  // 如果文件为 Markdown 且属于文本预览，则使用 ReactMarkdown 呈现
  const isMarkdown = 
    selectedPath &&
    selectedPath.toLowerCase().endsWith('.md') &&
    canEdit;

  // Markdown 代码块处理
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={syntaxStyle}
          language={match[1]}
          PreTag="div"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className="app">
      {/* 左侧文件树区域 */}
      <div className="leftPanel" style={{ width: leftPanelWidth }}>
        <h2>资源管理器</h2>
        {treeData && treeData.length > 0 ? (
          treeData.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              onFileSelect={handleFileSelect}
              initialPath={initialPath}
              selectedPath={selectedPath}
            />
          ))
        ) : (
          <p>没有目录数据。</p>
        )}
      </div>

      {/* 分隔条 */}
      <div className="divider" onMouseDown={handleMouseDown} />

      {/* 右侧预览/编辑区域 */}
      <div className="rightPanel">
        <h2>预览 {selectedPath ? `- ${selectedPath}` : ""}</h2>
        {loadingPreview ? (
          <p>加载中...</p>
        ) : isEditing ? (
          <div className="editor-area">
            <div className="editor-toolbar">
              <button onClick={toggleEditorMode}>
                切换到 {editorMode === "source" ? "所见即所得" : "源代码"} 模式
              </button>
            </div>
            {editorMode === "source" ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            ) : (
              <div
                ref={visualRef}
                className="visual-editor"
                contentEditable
                dangerouslySetInnerHTML={{ __html: marked(editContent) }}
              />
            )}
            <div className="commit-area">
              <input
                type="text"
                placeholder="提交说明"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
              />
              <button onClick={handleCommit} disabled={saving}>
                {saving ? "提交中..." : "提交更改"}
              </button>
              <button onClick={handleCancelEdit}>取消</button>
            </div>
          </div>
        ) : (
          <div className="preview-container">
            {previewMeta && previewMeta.isImage ? (
              <img
                src={`data:${previewMeta.mimeType};base64,${preview}`}
                alt="预览图片"
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 150px)',
                  objectFit: 'contain'
                }}
              />
            ) : previewMeta && previewMeta.isBinary ? (
              <div>二进制文件无法预览</div>
            ) : isMarkdown ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {preview}
              </ReactMarkdown>
            ) : (
              <pre>{preview}</pre>
            )}
            {canEdit && (
              <div style={{ marginTop: '1rem' }}>
                <button onClick={handleEdit}>编辑文件</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 全局样式，参考 vscode.dev */}
      <style jsx global>{`
        /* 全局背景和字体 */
        body {
          margin: 0;
          padding: 0;
          background: #1e1e1e;
          color: #d4d4d4;
          font-family: "Segoe UI", Tahoma, sans-serif;
          font-size: 14px;
        }
        .app {
          display: flex;
          height: 100vh;
          background: #1e1e1e;
        }
        /* 左侧资源管理器 */
        .leftPanel {
          background: #252526;
          border-right: 1px solid #3c3c3c;
          padding: 10px;
          overflow-y: auto;
          width: 300px;
        }
        .leftPanel h2 {
          color: #cccccc;
          margin: 0 0 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid #3c3c3c;
        }
        /* 分隔条 */
        .divider {
          width: 5px;
          cursor: col-resize;
          background: #3c3c3c;
        }
        /* 右侧预览与编辑区域 */
        .rightPanel {
          flex: 1;
          background: #1e1e1e;
          padding: 20px;
          overflow-y: auto;
        }
        .rightPanel h2 {
          color: #cccccc;
          margin: 0 0 15px;
          border-bottom: 1px solid #3c3c3c;
          padding-bottom: 5px;
        }
        /* 按钮风格 */
        button {
          background: #0e639c;
          border: none;
          color: #ffffff;
          padding: 6px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 14px;
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        /* 输入框风格 */
        input[type="text"] {
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          padding: 6px;
          border-radius: 3px;
          color: #d4d4d4;
          font-size: 14px;
        }
        /* 文本编辑区（源代码模式） */
        textarea {
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          color: #d4d4d4;
          width: 100%;
          height: 300px;
          padding: 10px;
          font-family: Consolas, "Courier New", monospace;
          border-radius: 3px;
          font-size: 14px;
        }
        /* 可视化编辑区 */
        .visual-editor {
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          padding: 10px;
          border-radius: 3px;
          min-height: 300px;
        }
        /* commit 信息区 */
        .commit-area {
          margin-top: 10px;
        }
        .commit-area input[type="text"] {
          width: 60%;
          margin-right: 10px;
        }
        /* 代码预览及代码块 */
        pre {
          background: #1e1e1e;
          padding: 10px;
          border-radius: 3px;
          overflow: auto;
        }
        code {
          background: #1e1e1e;
          padding: 2px 4px;
          border-radius: 3px;
        }
        /* 文件树节点 */
        .tree-node {
          margin-left: 10px;
        }
        .node-label {
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
        }
        .node-label.selected {
          background: #094771;
          color: #ffffff;
        }
      `}</style>
    </div>
  );
}

/**
 * getServerSideProps：读取环境变量，
 * 获取仓库基本信息、默认分支与完整文件树，同时解析初始展开目录
 */
export async function getServerSideProps() {
  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE;
  if (!githubUserToken || !githubRoute) {
    return {
      props: { error: '环境变量 GITHUB_USER_TOKEN 或 GITHUB_ROUTE 未设置' },
    };
  }

  const routeParts = githubRoute.split('/');
  if (routeParts.length < 2) {
    return {
      props: { error: 'GITHUB_ROUTE 格式错误，应至少为 "owner/repo"' },
    };
  }
  const owner = routeParts[0];
  const repo = routeParts[1];
  const initialPath = routeParts.length > 2 ? routeParts.slice(2).join('/') : "";
  const headers = {
    Authorization: `token ${githubUserToken}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      const errorData = await repoResponse.json();
      return { props: { error: errorData.message || '无法获取仓库信息' } };
    }
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || 'main';

    const branchResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`,
      { headers }
    );
    if (!branchResponse.ok) {
      const errorData = await branchResponse.json();
      return { props: { error: errorData.message || '无法获取分支信息' } };
    }
    const branchData = await branchResponse.json();
    const treeSha = branchData.commit.commit.tree.sha;

    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
      { headers }
    );
    if (!treeResponse.ok) {
      const errorData = await treeResponse.json();
      return { props: { error: errorData.message || '无法获取树结构数据' } };
    }
    const treeDataJson = await treeResponse.json();
    const treeItems = treeDataJson.tree.filter((item) => item.path && item.mode);
    const tree = buildTree(treeItems);

    return {
      props: {
        treeData: tree,
        owner,
        repo,
        defaultBranch,
        initialPath,
      },
    };
  } catch (err) {
    return { props: { error: err.message || '数据获取出现异常' } };
  }
}
