import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import { tomorrow as syntaxStyle } from 'react-syntax-highlighter/dist/cjs/styles/prism';
// 加载 Markdown 语法支持
import "prismjs/components/prism-markdown";
import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * 将 GitHub API 返回的平面列表构建为嵌套的树形结构
 * @param {Array} flatList GitHub API 返回的数组（文件或目录对象）
 * @returns {Array} 树形结构数据
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
        // 找不到父节点归为顶级（异常数据）
        tree.push(item);
      }
    }
  });
  return tree;
}

/**
 * 递归组件：展示文件/文件夹节点
 * Props:
 *  - node: 当前节点数据
 *  - onFileSelect: 文件点击时的回调
 *  - initialPath: 初始展开的目录（仓库根后的子路径）
 *  - selectedPath: 当前选中的文件完整路径
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
      <div onClick={handleClick} className={`node-label ${isSelected ? 'selected' : ''}`}>
        {node.children && node.children.length > 0 ? (expanded ? '[-] ' : '[+] ') : '    '}
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
 *  - treeData: 仓库文件树数据
 *  - owner, repo, defaultBranch: 仓库基本信息
 *  - initialPath: 仓库根后希望初始展开的子目录路径
 *  - error: 错误信息（如果有）
 */
export default function Home({ treeData, owner, repo, defaultBranch, error, initialPath }) {
  // 预览与选择相关状态
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
  // 用于“源代码编辑”时召唤工具栏
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const editorRef = useRef(null); // 用于获取源码编辑器节点

  // 调整左侧面板宽度
  const handleMouseDown = (e) => {
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMouseMove = (e) => {
      const delta = e.clientX - startX;
      setLeftPanelWidth(Math.max(150, startWidth + delta));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  /**
   * 预览文件：调用 /api/preview 获取文件内容
   */
  const handleFileSelect = async (file) => {
    if (file.type !== "blob") return;
    setSelectedPath(file.path);
    setLoadingPreview(true);
    setPreview("");
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
   * 进入编辑模式：请求获取文件内容及 SHA（仅适用于文本文件）
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
      // 切换到所见即所得——通过 marked 将 Markdown 转为 HTML
      setEditorMode("visual");
    } else {
      // 切换回源代码编辑——利用 Turndown 将 HTML 转回 Markdown
      if (editorMode === "visual" && editorRef.current) {
        const tdService = new TurndownService();
        const markdown = tdService.turndown(editorRef.current.innerHTML);
        setEditContent(markdown);
      }
      setEditorMode("source");
    }
  };

  /**
   * 源代码编辑时的工具栏命令处理：
   * 根据命令，在编辑内容末尾追加相应 Markdown 语法（简化实现）
   */
  const handleToolbarCommand = (cmd) => {
    let snippet = "";
    switch (cmd) {
      case "bold":
        snippet = "**bold text**";
        break;
      case "italic":
        snippet = "*italic text*";
        break;
      case "link":
        snippet = "[link text](http://example.com)";
        break;
      case "code":
        snippet = "`code snippet`";
        break;
      case "quote":
        snippet = "> quote";
        break;
      default:
        break;
    }
    setEditContent(editContent + snippet);
    setToolbarVisible(false);
  };

  /**
   * 提交更改：调用 /api/save 将更新后的文件写入 GitHub
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
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        alert("提交失败：" + errText);
      } else {
        alert("提交成功！");
        setIsEditing(false);
        // 重新加载预览内容
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

  // 仅对文本预览允许编辑
  const canEdit = previewMeta && !previewMeta.isBinary && !previewMeta.isImage;

  // 如果是 Markdown 文件且文本文件，则使用 ReactMarkdown 呈现预览
  const isMarkdownFile =
    selectedPath &&
    selectedPath.toLowerCase().endsWith('.md') &&
    canEdit;

  // Markdown代码块处理
  const markdownComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter style={syntaxStyle} language={match[1]} PreTag="div" {...props}>
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
  };

  return (
    <div className="app">
      {/* 左侧资源管理器 */}
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
              <div
                onKeyDown={(e) => {
                  if (e.key === "/") {
                    setToolbarVisible(true);
                  } else if (e.key === "Escape") {
                    setToolbarVisible(false);
                  }
                }}
              >
                <Editor
                  ref={editorRef}
                  value={editContent}
                  onValueChange={(code) => setEditContent(code)}
                  highlight={(code) =>
                    Prism.highlight(code, Prism.languages.markdown, "markdown")
                  }
                  padding={10}
                  style={{
                    fontFamily: '"Fira Code", monospace',
                    fontSize: 14,
                    backgroundColor: "#ffffff",
                    color: "#000000",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    minHeight: "300px"
                  }}
                />
                {toolbarVisible && (
                  <div className="toolbar">
                    <button onClick={() => handleToolbarCommand("bold")}>Bold</button>
                    <button onClick={() => handleToolbarCommand("italic")}>Italic</button>
                    <button onClick={() => handleToolbarCommand("link")}>Link</button>
                    <button onClick={() => handleToolbarCommand("code")}>Code</button>
                    <button onClick={() => handleToolbarCommand("quote")}>Quote</button>
                  </div>
                )}
              </div>
            ) : (
              <div
                ref={editorRef}
                className="visual-editor"
                contentEditable
                dangerouslySetInnerHTML={{ __html: marked(editContent) }}
                onInput={(e) => {
                  // 可在切换回源代码模式时使用 Turndown 进行转换（将在切换时处理）
                }}
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
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 150px)",
                  objectFit: "contain"
                }}
              />
            ) : previewMeta && previewMeta.isBinary ? (
              <div style={{ padding: "1rem", color: "#888" }}>二进制文件无法预览</div>
            ) : isMarkdownFile ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {preview}
              </ReactMarkdown>
            ) : (
              <pre>{preview}</pre>
            )}
            {canEdit && (
              <div className="edit-btn">
                <button onClick={handleEdit}>编辑文件</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 全局样式，参考 Inkdown 及 vscode.dev（亮色模式） */}
      <style jsx global>{`
        /* 全局基本样式 */
        body {
          margin: 0;
          padding: 0;
          background: #ffffff;
          color: #333;
          font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
          font-size: 14px;
        }
        .app {
          display: flex;
          height: 100vh;
          background: #ffffff;
        }
        /* 左侧资源管理器 */
        .leftPanel {
          background: #f8f8f8;
          border-right: 1px solid #ddd;
          padding: 10px;
          overflow-y: auto;
        }
        .leftPanel h2 {
          margin: 0 0 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid #ddd;
          color: #555;
        }
        /* 分隔条 */
        .divider {
          width: 5px;
          cursor: col-resize;
          background: #ddd;
        }
        /* 右侧预览/编辑区域 */
        .rightPanel {
          flex: 1;
          background: #ffffff;
          padding: 20px;
          overflow-y: auto;
        }
        .rightPanel h2 {
          margin: 0 0 15px;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          color: #555;
        }
        /* 按钮 */
        button {
          background: #007acc;
          border: none;
          color: #fff;
          padding: 6px 12px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 14px;
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        /* 输入框 */
        input[type="text"] {
          border: 1px solid #ccc;
          padding: 6px;
          border-radius: 3px;
          font-size: 14px;
          margin-right: 10px;
          color: #333;
          background: #fff;
        }
        /* 文本预览 */
        pre {
          background: #f5f5f5;
          padding: 10px;
          border-radius: 3px;
          overflow: auto;
        }
        code {
          background: #f5f5f5;
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
          background: #e7f3ff;
          border-left: 3px solid #007acc;
          color: #007acc;
        }
        /* 编辑区 */
        .editor-area {
          position: relative;
        }
        .visual-editor {
          border: 1px solid #ccc;
          padding: 10px;
          border-radius: 3px;
          min-height: 300px;
          background: #fff;
          color: #333;
        }
        /* 我们使用 react-simple-code-editor，编辑器区域的样式通过内联定义 */
        .commit-area {
          margin-top: 10px;
        }
        .commit-area input[type="text"] {
          width: 60%;
        }
        .edit-btn {
          margin-top: 1rem;
        }
        /* 工具栏 */
        .toolbar {
          position: absolute;
          top: -40px;
          left: 0;
          background: #fff;
          border: 1px solid #ddd;
          border-radius: 3px;
          padding: 5px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          z-index: 10;
        }
        .toolbar button {
          margin-right: 5px;
          background: #007acc;
        }
      `}</style>
    </div>
  );
}

/**
 * getServerSideProps：
 *  读取环境变量，获取仓库基本信息、默认分支与完整文件树，
 *  并解析 GITHUB_ROUTE 中除 owner/repo 之外的部分作为初始展开目录。
 */
export async function getServerSideProps() {
  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE;
  if (!githubUserToken || !githubRoute) {
    return {
      props: { error: '环境变量 GITHUB_USER_TOKEN 或 GITHUB_ROUTE 未设置' }
    };
  }
  const routeParts = githubRoute.split('/');
  if (routeParts.length < 2) {
    return {
      props: { error: 'GITHUB_ROUTE 格式错误，应至少为 "owner/repo"' }
    };
  }
  const owner = routeParts[0];
  const repo = routeParts[1];
  const initialPath = routeParts.length > 2 ? routeParts.slice(2).join('/') : "";
  const headers = {
    Authorization: `token ${githubUserToken}`,
    Accept: 'application/vnd.github.v3+json'
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
    const treeItems = treeDataJson.tree.filter(item => item.path && item.mode);
    const tree = buildTree(treeItems);
    return {
      props: {
        treeData: tree,
        owner,
        repo,
        defaultBranch,
        initialPath
      }
    };
  } catch (err) {
    return { props: { error: err.message || '数据获取出现异常' } };
  }
}
