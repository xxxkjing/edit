import React, { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow as syntaxStyle } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * 将 GitHub API 返回的平面列表构建为树形结构数据
 * @param {Array} flatList - GitHub API 返回的数组，包含 file/tree 对象
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
        // 找不到父节点时归为顶级节点（异常数据）
        tree.push(item);
      }
    }
  });

  return tree;
}

/**
 * 递归组件：展示文件夹/文件节点
 * Props:
 * - node: 当前节点数据
 * - onFileSelect: 当文件被点击时触发回调
 * - initialPath: 初始展开路径设置（仓库根后子目录路径）
 * - selectedPath: 当前选中的文件完整路径
 */
function TreeNode({ node, onFileSelect, initialPath, selectedPath }) {
  // 若 initialPath 存在且当前节点为文件夹，并且 initialPath 与当前节点匹配或为其前缀，则自动展开
  const shouldExpand =
    initialPath &&
    node.type === 'tree' &&
    (initialPath === node.path || initialPath.startsWith(node.path + '/'));
  const [expanded, setExpanded] = useState(!!shouldExpand);

  // 如果当前节点与初始路径精确匹配，则高亮；
  // 如果当前为文件且路径等于选中路径，则显示选中状态
  const isHighlighted = node.type === 'tree' && initialPath === node.path;
  const isSelected = node.type === 'blob' && selectedPath === node.path;

  const handleClick = () => {
    if (node.type === 'tree') {
      setExpanded(!expanded);
    } else if (node.type === 'blob') {
      onFileSelect && onFileSelect(node);
    }
  };

  const nodeStyle = {
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: isSelected ? '#f0f8ff' : isHighlighted ? '#ffffe0' : 'transparent',
    borderLeft: isSelected ? '3px solid #0070f3' : 'none',
    padding: '4px 8px',
    borderRadius: '4px',
    margin: '2px 0',
  };

  return (
    <div style={{ marginLeft: '20px' }}>
      <div onClick={handleClick} style={nodeStyle}>
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
 * - treeData: 仓库文件树数据
 * - owner, repo, defaultBranch: 仓库基本信息
 * - initialPath: 用户配置的初始展开子目录路径（仓库根后的路径）
 * - error: 错误信息（如有）
 */
export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  // 预览、文件选择相关状态
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState('');
  const [previewMeta, setPreviewMeta] = useState(null); // 保存 API 返回的附加信息（如 isImage、isBinary 等）
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

  // 拖拽调整左侧面板宽度
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
   * 预览文件（仅展示预览，不进入编辑模式）
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
    setIsEditing(false); // 若此前处于编辑状态，则退出编辑
  };

  /**
   * 进入编辑模式：调用 /api/preview 时使用 edit=true 获取带有 sha 的信息
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
        alert("获取编辑文件内容失败：" + errText);
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
   * 切换编辑模式：源代码编辑 与 可视化编辑
   */
  const toggleEditorMode = () => {
    if (editorMode === "source") {
      // 切换到可视化编辑
      setEditorMode("visual");
    } else {
      // 切换回源代码编辑
      // 采用 Turndown 将 visual 编辑区内容转换回 markdown
      if (visualRef.current) {
        const tdService = new TurndownService();
        const markdown = tdService.turndown(visualRef.current.innerHTML);
        setEditContent(markdown);
      }
      setEditorMode("source");
    }
  };

  /**
   * 提交更改：调用 /api/save 提交更新后的文件内容
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
          content: editContent, // 保持 markdown 格式
          sha: fileSha,
          branch: defaultBranch
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        alert("提交失败： " + errText);
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

  // 判断是否为 Markdown 文本（仅对源文件进行 Markdown 渲染）
  const isMarkdown =
    selectedPath &&
    selectedPath.toLowerCase().endsWith('.md') &&
    (!previewMeta || (!previewMeta.isBinary && !previewMeta.isImage));

  // Markdown 代码块处理组件
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
    },
  };

  return (
    <div className="app">
      {/* 左侧：文件树区域 */}
      <div className="leftPanel" style={{ width: leftPanelWidth, minWidth: 150 }}>
        <h2>仓库文件树</h2>
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
          <p>没有目录数据可显示。</p>
        )}
      </div>

      {/* 分隔条 */}
      <div className="divider" onMouseDown={handleMouseDown} />

      {/* 右侧：预览/编辑区域 */}
      <div className="rightPanel">
        <h2>
          预览 {selectedPath ? `- ${selectedPath}` : '（未选择文件）'}
        </h2>
        {loadingPreview ? (
          <p>加载预览…</p>
        ) : isEditing ? (
          // 编辑模式
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <button onClick={toggleEditorMode}>
                切换到 {editorMode === "source" ? "所见即所得" : "源代码编辑"} 模式
              </button>
            </div>
            {editorMode === "source" ? (
              <textarea
                style={{ width: '100%', height: '300px', fontFamily: 'monospace', fontSize: '14px' }}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            ) : (
              <div
                ref={visualRef}
                contentEditable
                style={{
                  width: '100%',
                  minHeight: '300px',
                  border: '1px solid #ddd',
                  padding: '10px',
                  borderRadius: '4px'
                }}
                // 初始化时填充 HTML（由 marked 转换而来）
                dangerouslySetInnerHTML={{ __html: marked(editContent) }}
                onInput={(e) => {
                  // 此处不直接同步 editContent，如果切换回源代码模式时再转换即可
                }}
              />
            )}
            <div style={{ marginTop: '1rem' }}>
              <input
                type="text"
                placeholder="请输入提交信息"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                style={{ width: '60%', padding: '8px', marginRight: '10px' }}
              />
              <button onClick={handleCommit} disabled={saving}>
                {saving ? "提交中..." : "提交更改"}
              </button>
              <button onClick={handleCancelEdit} style={{ marginLeft: '10px' }}>
                取消编辑
              </button>
            </div>
          </div>
        ) : (
          // 预览模式
          <div>
            {previewMeta && previewMeta.isImage ? (
              <img
                src={`data:${previewMeta.mimeType};base64,${preview}`}
                alt="预览图片"
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(100vh - 100px)',
                  objectFit: 'contain'
                }}
              />
            ) : previewMeta && previewMeta.isBinary ? (
              <div style={{ padding: '1rem', color: '#888' }}>二进制文件无法预览</div>
            ) : isMarkdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {preview}
              </ReactMarkdown>
            ) : (
              <pre>{preview}</pre>
            )}
            {/* 如果当前预览文件是文本，则显示“编辑”按钮 */}
            {previewMeta && !previewMeta.isBinary && !previewMeta.isImage && (
              <div style={{ marginTop: '1rem' }}>
                <button onClick={handleEdit}>编辑</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 全局样式，参考 Typora 的简洁现代风格 */}
      <style jsx global>{`
        body {
          margin: 0;
          padding: 0;
          background: #fdfdfd;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color: #333;
          line-height: 1.6;
        }
        h1, h2, h3, h4, h5, h6 {
          font-weight: 600;
          margin: 1rem 0 0.5rem 0;
        }
        p {
          margin: 0 0 1rem;
        }
        a {
          color: #0366d6;
          text-decoration: none;
        }
        pre {
          background: #f6f8fa;
          padding: 1rem;
          border-radius: 4px;
          overflow: auto;
        }
        code {
          background: #f6f8fa;
          padding: 0.2rem 0.4rem;
          border-radius: 3px;
        }
        blockquote {
          margin: 0 0 1rem;
          padding: 0.5rem 1rem;
          border-left: 0.25rem solid #dfe2e5;
          background: #f6f8fa;
          color: #6a737d;
        }
        .app {
          display: flex;
          height: 100vh;
          background: #f5f7fa;
        }
        .leftPanel {
          background: #fff;
          overflow-y: auto;
          padding: 20px;
          border-right: 1px solid #eee;
          box-shadow: 2px 0 5px rgba(0,0,0,0.05);
        }
        .divider {
          width: 5px;
          cursor: col-resize;
          background: #eee;
        }
        .rightPanel {
          flex: 1;
          background: #fff;
          overflow-y: auto;
          padding: 20px;
        }
        .rightPanel h2 {
          border-bottom: 1px solid #eee;
          padding-bottom: 10px;
        }
      `}</style>
    </div>
  );
}

/**
 * getServerSideProps
 * - 从环境变量读取 GITHUB_USER_TOKEN 与 GITHUB_ROUTE（可追加初始路径）
 * - 获取仓库信息、默认分支及完整文件树，并转换为树形结构数据
 * - 如果 GITHUB_ROUTE 格式为 "owner/repo/child/folder"，则剩余部分作为初始展开路径
 */
export async function getServerSideProps() {
  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE; // 格式："owner/repo" 或 "owner/repo/child/folder"

  if (!githubUserToken || !githubRoute) {
    return {
      props: {
        error: '环境变量 GITHUB_USER_TOKEN 或 GITHUB_ROUTE 未设置',
      },
    };
  }

  const routeParts = githubRoute.split('/');
  if (routeParts.length < 2) {
    return {
      props: {
        error: 'GITHUB_ROUTE 格式错误，应至少为 "owner/repo"',
      },
    };
  }

  const owner = routeParts[0];
  const repo = routeParts[1];
  const initialPath = routeParts.length > 2 ? routeParts.slice(2).join('/') : '';

  const headers = {
    Authorization: `token ${githubUserToken}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    // 获取仓库基本信息（默认分支）
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!repoResponse.ok) {
      const errorData = await repoResponse.json();
      return { props: { error: errorData.message || '无法获取仓库信息' } };
    }
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || 'main';

    // 获取分支信息以获得树对象 SHA
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

    // 获取仓库完整文件树（递归获取所有目录和文件）
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
    return {
      props: { error: err.message || '数据获取出现异常' },
    };
  }
}
