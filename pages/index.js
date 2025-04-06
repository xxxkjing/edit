import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import { tomorrow as syntaxStyle } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { marked } from "marked";
import TurndownService from "turndown";

// 加载 Prism 的 Markdown 支持（如果需要其他语言，可在此扩展）
import "prismjs/components/prism-markdown";

/**
 * 将 GitHub API 返回的平面列表构建为嵌套树形结构数据
 */
function buildTree(flatList) {
  const tree = [];
  const map = {};
  flatList.forEach((item) => {
    item.children = [];
    map[item.path] = item;
    if (!item.path.includes("/")) {
      tree.push(item);
    } else {
      const parts = item.path.split("/");
      parts.pop();
      const parentPath = parts.join("/");
      if (map[parentPath]) {
        map[parentPath].children.push(item);
      } else {
        tree.push(item);
      }
    }
  });
  return tree;
}

/**
 * 文件树递归显示组件
 */
function TreeNode({ node, onFileSelect, initialPath, selectedPath }) {
  const shouldExpand =
    initialPath &&
    node.type === "tree" &&
    (initialPath === node.path || initialPath.startsWith(node.path + "/"));
  const [expanded, setExpanded] = useState(!!shouldExpand);
  const isHighlighted = node.type === "tree" && initialPath === node.path;
  const isSelected = node.type === "blob" && selectedPath === node.path;

  const handleClick = () => {
    if (node.type === "tree") {
      setExpanded(!expanded);
    } else if (node.type === "blob") {
      onFileSelect && onFileSelect(node);
    }
  };

  return (
    <div className="tree-node">
      <div
        onClick={handleClick}
        className={`node-label ${isSelected ? "selected" : ""}`}
      >
        {node.children && node.children.length > 0
          ? expanded
            ? "[-] "
            : "[+] "
          : "    "}
        {node.type === "tree" ? "📁" : "📄"} {node.path.split("/").pop()}
      </div>
      {expanded &&
        node.children &&
        node.children
          .sort((a, b) => {
            if (a.type === b.type) return a.path.localeCompare(b.path);
            return a.type === "tree" ? -1 : 1;
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
 */
export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  // 预览/文件选择状态
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState("");
  const [previewMeta, setPreviewMeta] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);

  // 编辑相关状态
  const [isEditing, setIsEditing] = useState(false);
  const [editorMode, setEditorMode] = useState("source"); // "source" or "visual"
  const [editContent, setEditContent] = useState("");
  const [fileSha, setFileSha] = useState(null);
  const [saving, setSaving] = useState(false);
  // 用于新建文件/文件夹的弹窗
  const [showNewModal, setShowNewModal] = useState(false);
  const [newType, setNewType] = useState(null); // "file" 或 "folder"
  const [newName, setNewName] = useState("");
  // 提交按钮模态框
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  // 编辑器引用（用于代码编辑模式）
  const editorRef = useRef(null);
  // 用于所见即所得编辑下引用
  const visualRef = useRef(null);

  // 调整左侧面板宽度的拖拽逻辑
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

  // 从 GitHub 获取选中文件的预览（进入预览模式，不进入编辑）
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

  // 进入编辑模式（仅对文本文件生效）
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

  // 切换编辑模式
  const toggleEditorMode = () => {
    if (editorMode === "source") {
      // 切换到所见即所得：通过 marked 将 Markdown 转为 HTML
      setEditorMode("visual");
    } else {
      // 切换回源代码编辑：使用 Turndown 将所见即所得内容转换回 Markdown
      if (visualRef.current) {
        const tdService = new TurndownService();
        const markdown = tdService.turndown(visualRef.current.innerHTML);
        setEditContent(markdown);
      }
      setEditorMode("source");
    }
  };

  // 源代码编辑时闪现工具栏（当按“/”键时显示），处理工具栏命令
  const handleToolbarCommand = (cmd) => {
    let snippet = "";
    switch (cmd) {
      case "bold":
        snippet = "**粗体**";
        break;
      case "italic":
        snippet = "*斜体*";
        break;
      case "link":
        snippet = "[链接文本](http://example.com)";
        break;
      case "code":
        snippet = "`代码`";
        break;
      case "quote":
        snippet = "> 引用";
        break;
      default:
        break;
    }
    setEditContent(editContent + snippet);
  };

  // 提交更新，调用 /api/save 接口
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
          branch: defaultBranch,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert("提交失败：" + errText);
      } else {
        alert("提交成功！");
        setIsEditing(false);
        setShowCommitModal(false);
        // 重新加载预览
        handleFileSelect({ path: selectedPath, type: "blob" });
      }
    } catch (e) {
      alert("提交异常: " + e.message);
    }
    setSaving(false);
  };

  // 新建文件或文件夹（此处仅为 UI 展示，后端实现请自行扩展）
  const handleNew = async () => {
    if (!newName) {
      alert("请输入名称");
      return;
    }
    // 此处调用新建 API ，目前仅为示例
    alert(`${newType === "file" ? "新建文件" : "新建文件夹"}：${newName} 功能待实现`);
    setShowNewModal(false);
    setNewName("");
    // 刷新文件树（请根据实际情况更新 treeData）
  };

  return (
    <div className="app">
      {/* 顶部工具栏 */}
      <div className="topbar">
        <div className="topbar-left">
          <button onClick={() => { setNewType("file"); setShowNewModal(true); }}>
            新建文件
          </button>
          <button onClick={() => { setNewType("folder"); setShowNewModal(true); }}>
            新建文件夹
          </button>
        </div>
        <div className="topbar-right">
          {isEditing && (
            <button onClick={() => setShowCommitModal(true)}>提交到 GitHub</button>
          )}
        </div>
      </div>

      {/* 左侧文件树区域 */}
      <div className="leftPanel" style={{ width: leftPanelWidth }}>
        <h2>文件资源管理器</h2>
        {treeData && treeData.length > 0
          ? treeData.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                onFileSelect={handleFileSelect}
                initialPath={initialPath}
                selectedPath={selectedPath}
              />
            ))
          : "暂无数据"}
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
                {editorMode === "source" ? "切换到所见即所得模式" : "切换到源代码模式"}
              </button>
            </div>
            {editorMode === "source" ? (
              <div
                onKeyDown={(e) => {
                  if (e.key === "/") setShowCommitModal(false); // 此处可触发工具栏显示
                }}
              >
                <Editor
                  value={editContent}
                  onValueChange={(code) => setEditContent(code)}
                  highlight={(code) =>
                    Prism.highlight(code, Prism.languages.markdown, "markdown")
                  }
                  padding={10}
                  style={{
                    fontFamily: '"Fira Code", monospace',
                    fontSize: 14,
                    backgroundColor: "#f5f5f5",
                    color: "#333",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    minHeight: "300px",
                  }}
                  ref={editorRef}
                />
              </div>
            ) : (
              <div
                ref={visualRef}
                className="visual-editor"
                contentEditable
                dangerouslySetInnerHTML={{ __html: marked(editContent) }}
              />
            )}
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
                  objectFit: "contain",
                }}
              />
            ) : previewMeta && previewMeta.isBinary ? (
              <div className="binary-tip">二进制文件无法预览</div>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {preview}
              </ReactMarkdown>
            )}
            {!previewMeta?.isBinary && !previewMeta?.isImage && (
              <div className="edit-btn">
                <button onClick={handleEdit}>编辑文件</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 新建文件/文件夹模态窗 */}
      {showNewModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>{newType === "file" ? "新建文件" : "新建文件夹"}</h3>
            <input
              type="text"
              placeholder="请输入名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={handleNew}>确定</button>
              <button onClick={() => setShowNewModal(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 提交模态窗，显示在页面右上角 */}
      {showCommitModal && (
        <div className="modal commit-modal">
          <div className="modal-content">
            <h3>输入提交信息</h3>
            <input
              type="text"
              placeholder="提交说明"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={handleCommit} disabled={saving}>
                {saving ? "提交中..." : "提交"}
              </button>
              <button onClick={() => setShowCommitModal(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 全局样式 */}
      <style jsx global>{`
        /* 通用 */
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
        }
        /* 顶部工具栏 */
        .topbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 45px;
          background: #ffffff;
          border-bottom: 1px solid #ddd;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 15px;
          z-index: 1000;
        }
        .topbar button {
          margin-right: 10px;
        }
        .topbar-left button:last-child {
          margin-right: 0;
        }
        /* 左侧 */
        .leftPanel {
          background: #f8f8f8;
          border-right: 1px solid #ddd;
          padding: 60px 10px 10px 10px; /* 顶部预留工具栏 */
          overflow-y: auto;
        }
        .leftPanel h2 {
          margin: 0 0 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid #ddd;
          color: #555;
        }
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
        /* 分隔条 */
        .divider {
          width: 5px;
          cursor: col-resize;
          background: #ddd;
        }
        /* 右侧 */
        .rightPanel {
          flex: 1;
          padding: 60px 20px 20px 20px; /* 顶部预留工具栏 */
          overflow-y: auto;
        }
        .rightPanel h2 {
          margin: 0 0 15px;
          border-bottom: 1px solid #ddd;
          padding-bottom: 5px;
          color: #555;
        }
        .preview-container pre {
          background: #f5f5f5;
          padding: 10px;
          border-radius: 3px;
          overflow: auto;
        }
        .preview-container img {
          max-width: 100%;
          max-height: 400px;
          object-fit: scale-down;
          display: block;
          margin: 10px auto;
        }
        .binary-tip {
          padding: 1rem;
          color: #888;
        }
        .edit-btn {
          margin-top: 1rem;
        }
        /* 编辑区域 */
        .editor-area {
          position: relative;
        }
        .editor-toolbar {
          margin-bottom: 10px;
        }
        .visual-editor {
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 3px;
          min-height: 300px;
          background: #f5f5f5;
          color: #333;
        }
        textarea {
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 3px;
          width: 100%;
          min-height: 300px;
          font-family: Consolas, "Courier New", monospace;
        }
        .commit-area {
          margin-top: 10px;
        }
        .commit-area input[type="text"] {
          width: 60%;
          margin-right: 10px;
        }
        /* 模态窗 */
        .modal {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 2000;
        }
        .modal-content {
          background: #ffffff;
          padding: 20px;
          border-radius: 5px;
          width: 300px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        .modal-buttons {
          margin-top: 15px;
          display: flex;
          justify-content: flex-end;
        }
        .modal-buttons button {
          margin-left: 10px;
        }
        /* 工具栏（源码编辑时召唤） */
        .toolbar {
          position: absolute;
          top: -40px;
          left: 0;
          background: #ffffff;
          border: 1px solid #ddd;
          padding: 5px;
          border-radius: 3px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          z-index: 10;
        }
        .toolbar button {
          margin-right: 5px;
        }
      `}</style>
    </div>
  );
}

/**
 * getServerSideProps
 * 读取环境变量，调用 GitHub API 获取仓库信息、默认分支和树结构，
 * 并将 GITHUB_ROUTE 中除 owner/repo 部分作为初始展开目录传递。
 */
export async function getServerSideProps() {
  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE;
  if (!githubUserToken || !githubRoute) {
    return { props: { error: "环境变量 GITHUB_USER_TOKEN 或 GITHUB_ROUTE 未设置" } };
  }
  const routeParts = githubRoute.split("/");
  if (routeParts.length < 2) {
    return { props: { error: 'GITHUB_ROUTE 格式错误，应至少为 "owner/repo"' } };
  }
  const owner = routeParts[0];
  const repo = routeParts[1];
  const initialPath = routeParts.length > 2 ? routeParts.slice(2).join("/") : "";
  const headers = {
    Authorization: `token ${githubUserToken}`,
    Accept: "application/vnd.github.v3+json",
  };
  try {
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    if (!repoResponse.ok) {
      const errorData = await repoResponse.json();
      return { props: { error: errorData.message || "无法获取仓库信息" } };
    }
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || "main";

    const branchResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`,
      { headers }
    );
    if (!branchResponse.ok) {
      const errorData = await branchResponse.json();
      return { props: { error: errorData.message || "无法获取分支信息" } };
    }
    const branchData = await branchResponse.json();
    const treeSha = branchData.commit.commit.tree.sha;

    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
      { headers }
    );
    if (!treeResponse.ok) {
      const errorData = await treeResponse.json();
      return { props: { error: errorData.message || "无法获取树结构数据" } };
    }
    const treeDataJson = await treeResponse.json();
    const treeItems = treeDataJson.tree.filter((item) => item.path && item.mode);
    const tree = buildTree(treeItems);
    return { props: { treeData: tree, owner, repo, defaultBranch, initialPath } };
  } catch (err) {
    return { props: { error: err.message || "数据获取出现异常" } };
  }
}
