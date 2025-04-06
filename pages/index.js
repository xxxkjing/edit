import React, { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import { marked } from "marked";
import TurndownService from "turndown";

// 加载 Prism 语言支持（这里加载 Markdown）
import "prismjs/components/prism-markdown";

// 自定义的 Markdown 代码块组件，用于代码高亮
const MarkdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    return !inline && match ? (
      <pre className="p-2 bg-gray-100 rounded overflow-x-auto">
        <code>
          {Prism.highlight(
            String(children).replace(/\n$/, ""),
            Prism.languages.markdown,
            "markdown"
          )}
        </code>
      </pre>
    ) : (
      <code className="bg-gray-100 p-1 rounded" {...props}>
        {children}
      </code>
    );
  },
};

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

function TreeNode({ node, onFileSelect, initialPath, selectedPath }) {
  const shouldExpand =
    initialPath &&
    node.type === "tree" &&
    (initialPath === node.path || initialPath.startsWith(node.path + "/"));
  const [expanded, setExpanded] = useState(!!shouldExpand);
  const isSelected = node.type === "blob" && selectedPath === node.path;
  const handleClick = () => {
    if (node.type === "tree") {
      setExpanded(!expanded);
    } else if (node.type === "blob") {
      onFileSelect && onFileSelect(node);
    }
  };
  return (
    <div className="ml-2">
      <div
        onClick={handleClick}
        className={`cursor-pointer px-2 py-1 rounded hover:bg-blue-100 ${
          isSelected ? "bg-blue-200 border-l-4 border-blue-500" : ""
        }`}
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

export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState("");
  const [previewMeta, setPreviewMeta] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);

  // 编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editorMode, setEditorMode] = useState("source");
  const [editContent, setEditContent] = useState("");
  const [fileSha, setFileSha] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newType, setNewType] = useState(null);
  const [newName, setNewName] = useState("");
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  // 编辑器引用
  const editorRef = useRef(null);
  const visualRef = useRef(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);

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

  const toggleEditorMode = () => {
    if (editorMode === "source") {
      setEditorMode("visual");
    } else {
      if (visualRef.current) {
        const tdService = new TurndownService();
        const markdown = tdService.turndown(visualRef.current.innerHTML);
        setEditContent(markdown);
      }
      setEditorMode("source");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "/") {
      setToolbarVisible(true);
    } else if (e.key === "Escape") {
      setToolbarVisible(false);
    }
  };

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
        snippet = "[链接](http://example.com)";
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
    setEditContent((prev) => prev + snippet);
    setToolbarVisible(false);
  };

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

  const handleNew = () => {
    if (!newName) {
      alert("请输入名称");
      return;
    }
    alert(`${newType === "file" ? "新建文件" : "新建文件夹"}：${newName} 功能待实现`);
    setShowNewModal(false);
    setNewName("");
  };

  // 仅允许文本文件编辑
  const canEdit = previewMeta && !previewMeta.isBinary && !previewMeta.isImage;
  const isMarkdownFile =
    selectedPath &&
    selectedPath.toLowerCase().endsWith(".md") &&
    canEdit;

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部工具栏 */}
      <div className="topbar fixed top-0 inset-x-0 h-12 bg-white border-b border-gray-200 flex justify-between items-center px-4 z-50">
        <div className="space-x-2">
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => {
              setNewType("file");
              setShowNewModal(true);
            }}
          >
            新建文件
          </button>
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => {
              setNewType("folder");
              setShowNewModal(true);
            }}
          >
            新建文件夹
          </button>
        </div>
        {isEditing && (
          <button
            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
            onClick={() => setShowCommitModal(true)}
          >
            提交到 GitHub
          </button>
        )}
      </div>

      <div className="flex flex-1 pt-12">
        {/* 左侧文件树 */}
        <div className="leftPanel bg-gray-50 border-r border-gray-200 p-4 overflow-y-auto" style={{ width: leftPanelWidth }}>
          <h2 className="text-gray-700 mb-3 border-b border-gray-300 pb-1">
            文件资源管理器
          </h2>
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
            <p>暂无数据</p>
          )}
        </div>

        {/* 分隔条 */}
        <div
          className="divider bg-gray-200 cursor-col-resize"
          onMouseDown={handleMouseDown}
        />

        {/* 右侧预览/编辑区域 */}
        <div className="rightPanel flex-1 p-6 overflow-y-auto bg-white">
          <h2 className="text-gray-700 mb-4 border-b border-gray-300 pb-2">
            预览 {selectedPath ? `- ${selectedPath}` : ""}
          </h2>
          {loadingPreview ? (
            <p>加载中...</p>
          ) : isEditing ? (
            <div className="editor-area relative">
              <div className="editor-toolbar mb-2">
                <button
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 mr-2"
                  onClick={toggleEditorMode}
                >
                  {editorMode === "source" ? "切换到所见即所得" : "切换到源代码"}
                </button>
              </div>
              {editorMode === "source" ? (
                <div onKeyDown={handleKeyDown}>
                  <Editor
                    value={editContent}
                    onValueChange={(code) => setEditContent(code)}
                    highlight={(code) =>
                      Prism.highlight(code, Prism.languages.markdown, "markdown")
                    }
                    padding={10}
                    className="border border-gray-300 rounded bg-gray-100 text-gray-800 min-h-[300px]"
                    style={{ fontFamily: '"Fira Code", monospace', fontSize: 14 }}
                    ref={editorRef}
                  />
                  {toolbarVisible && (
                    <div className="toolbar absolute top-[-40px] left-0 bg-white border border-gray-200 rounded shadow px-2 py-1">
                      <button onClick={() => handleToolbarCommand("bold")} className="mr-1">
                        Bold
                      </button>
                      <button onClick={() => handleToolbarCommand("italic")} className="mr-1">
                        Italic
                      </button>
                      <button onClick={() => handleToolbarCommand("link")} className="mr-1">
                        Link
                      </button>
                      <button onClick={() => handleToolbarCommand("code")} className="mr-1">
                        Code
                      </button>
                      <button onClick={() => handleToolbarCommand("quote")}>Quote</button>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  ref={visualRef}
                  className="visual-editor border border-gray-300 rounded bg-gray-100 p-4 min-h-[300px]"
                  contentEditable
                  dangerouslySetInnerHTML={{ __html: marked(editContent) }}
                />
              )}
              <div className="commit-area mt-3 flex items-center">
                <input
                  type="text"
                  placeholder="提交说明"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  className="border border-gray-300 rounded p-2 w-2/3 text-gray-800"
                />
                <button
                  className="ml-3 px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                  onClick={handleCommit}
                  disabled={saving}
                >
                  {saving ? "提交中..." : "提交更改"}
                </button>
                <button
                  className="ml-3 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                  onClick={handleCancelEdit}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="preview-container">
              {previewMeta && previewMeta.isImage ? (
                <img
                  src={`data:${previewMeta.mimeType};base64,${preview}`}
                  alt="预览图片"
                  className="max-w-full max-h-[400px] object-contain mx-auto my-4"
                />
              ) : previewMeta && previewMeta.isBinary ? (
                <div className="text-gray-500 p-4">二进制文件无法预览</div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  components={MarkdownComponents}
                  className="prose prose-sm"
                >
                  {preview}
                </ReactMarkdown>
              )}
              {previewMeta && !previewMeta.isBinary && !previewMeta.isImage && (
                <div className="edit-btn mt-4">
                  <button
                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    onClick={handleEdit}
                  >
                    编辑文件
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 新建文件/文件夹弹窗 */}
      {showNewModal && (
        <div className="modal fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
          <div className="modal-content bg-white p-4 rounded shadow w-72">
            <h3 className="mb-2 text-gray-700">
              {newType === "file" ? "新建文件" : "新建文件夹"}
            </h3>
            <input
              type="text"
              placeholder="请输入名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 text-gray-800"
            />
            <div className="modal-buttons mt-3 flex justify-end">
              <button
                onClick={handleNew}
                className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                确定
              </button>
              <button
                onClick={() => setShowNewModal(false)}
                className="ml-2 px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提交弹窗 */}
      {showCommitModal && (
        <div className="modal fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50">
          <div className="modal-content bg-white p-4 rounded shadow w-72">
            <h3 className="mb-2 text-gray-700">输入提交信息</h3>
            <input
              type="text"
              placeholder="提交说明"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 text-gray-800"
            />
            <div className="modal-buttons mt-3 flex justify-end">
              <button
                onClick={handleCommit}
                disabled={saving}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
              >
                {saving ? "提交中..." : "提交"}
              </button>
              <button
                onClick={() => setShowCommitModal(false)}
                className="ml-2 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
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
