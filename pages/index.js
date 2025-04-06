import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow as syntaxStyle } from 'react-syntax-highlighter/dist/cjs/styles/prism';

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
 * - initialPath: 初始展开路径设置（字符串，仓库根后子目录路径）
 * - selectedPath: 当前选中的文件完整路径
 */
function TreeNode({ node, onFileSelect, initialPath, selectedPath }) {
  // 自动展开：如果 initialPath 存在且当前节点为文件夹，并且 initialPath 与当前节点匹配或以其为前缀
  const shouldExpand =
    initialPath &&
    node.type === 'tree' &&
    (initialPath === node.path || initialPath.startsWith(node.path + '/'));
  const [expanded, setExpanded] = useState(!!shouldExpand);

  // 当节点正好与初始路径精确匹配时（初始展开状态下）
  const isHighlighted = node.type === 'tree' && initialPath === node.path;
  // 如果当前节点为文件，并且其路径与选中路径匹配，标记选中状态
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
 * - error: 错误信息（如果有）
 */
export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState('');
  const [previewMeta, setPreviewMeta] = useState(null); // 存储返回的附加信息
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);

  // 分隔条拖拽逻辑
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
   * 处理文件选择，调用 API 路由获取文件预览内容
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
        setPreviewMeta(data); // 保存返回的附加信息
      }
    } catch (e) {
      setPreview(`Error: ${e.message}`);
    }
    setLoadingPreview(false);
  };

  if (error) {
    return (
      <div className="container">
        <h1>加载仓库数据错误</h1>
        <p>{error}</p>
      </div>
    );
  }

  // 判断是否为 Markdown 文件（仅对文本内容进行 Markdown 渲染）
  const isMarkdown =
    selectedPath && selectedPath.toLowerCase().endsWith('.md');

  // Markdown 代码块处理组件
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
      {/* 左侧：文件树面板 */}
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

      {/* 右侧：预览面板 */}
      <div className="rightPanel">
        <h2>
          预览 {selectedPath ? `- ${selectedPath}` : '（未选择文件）'}
        </h2>
        {loadingPreview ? (
          <p>加载预览…</p>
        ) : previewMeta && previewMeta.isImage ? (
          // 图片预览：追加 max-width 和 max-height 适应页面
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
          // 非图片二进制文件提示
          <div style={{ padding: '1rem', color: '#888' }}>
            二进制文件无法预览
          </div>
        ) : isMarkdown ? (
          // Markdown 文件预览，代码高亮处理
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {preview}
          </ReactMarkdown>
        ) : (
          // 其他文件以纯文本预览
          <pre>{preview}</pre>
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
 * - 若 GITHUB_ROUTE 格式为 "owner/repo/child/folder"，则剩余部分作为初始展开路径
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
      return {
        props: { error: errorData.message || '无法获取仓库信息' },
      };
    }
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || 'main';

    // 获取分支信息以得到树对象 SHA
    const branchResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`,
      { headers }
    );
    if (!branchResponse.ok) {
      const errorData = await branchResponse.json();
      return {
        props: { error: errorData.message || '无法获取分支信息' },
      };
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
      return {
        props: { error: errorData.message || '无法获取树结构数据' },
      };
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
      props: {
        error: err.message || '数据获取出现异常',
      },
    };
  }
}
