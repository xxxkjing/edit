import React, { useState } from 'react';

/**
 * 将 GitHub API 返回的平面数组构建为树形结构数据
 * @param {Array} flatList - GitHub API 返回的含 file/tree 对象的数组
 * @returns {Array} 嵌套的树形数据结构
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
        // 找不到父节点则归为顶级节点（异常数据）
        tree.push(item);
      }
    }
  });

  return tree;
}

/**
 * 递归组件：展示文件夹/文件节点
 * 新增 initialPath 参数，用于判断当前节点是否应自动展开
 */
function TreeNode({ node, onFileSelect, initialPath }) {
  // 判断是否需要自动展开：
  // 如果 initialPath 存在，并且该节点为文件夹且 node.path 与 initialPath 匹配（同等或为前缀），则默认展开
  const shouldExpand =
    initialPath &&
    node.type === 'tree' &&
    (initialPath === node.path || initialPath.startsWith(node.path + '/'));
    
  const [expanded, setExpanded] = useState(!!shouldExpand);
  
  // 如果当前文件夹正好与初始路径匹配，则使用高亮样式
  const isHighlighted = node.type === 'tree' && initialPath === node.path;

  const handleClick = () => {
    if (node.type === 'tree') {
      setExpanded(!expanded);
    } else if (node.type === 'blob') {
      // 文件节点点击时调用文件选择回调
      onFileSelect && onFileSelect(node);
    }
  };

  return (
    <div style={{ marginLeft: '20px' }}>
      <div
        onClick={handleClick}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isHighlighted ? '#ffffe0' : 'inherit',
          padding: '2px 4px'
        }}
      >
        {node.children && node.children.length > 0
          ? expanded
            ? '[-] '
            : '[+] '
          : '    '}
        {node.type === 'tree' ? '📁' : '📄'}{' '}
        {node.path.split('/').pop()}
      </div>
      {expanded &&
        node.children &&
        node.children
          .sort((a, b) => {
            // 文件夹优先显示，其次按名称排序
            if (a.type === b.type) {
              return a.path.localeCompare(b.path);
            }
            return a.type === 'tree' ? -1 : 1;
          })
          .map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              onFileSelect={onFileSelect}
              initialPath={initialPath}
            />
          ))}
    </div>
  );
}

/**
 * 主页面组件
 * Props 包含：
 * - treeData：构建好的仓库文件树
 * - owner, repo, defaultBranch：仓库信息
 * - initialPath：希望初始展开的子目录路径（相对仓库根路径）
 * - error：错误信息
 */
export default function Home({
  treeData,
  owner,
  repo,
  defaultBranch,
  error,
  initialPath,
}) {
  // 用于存储当前选中的文件路径、预览内容及加载状态
  const [selectedPath, setSelectedPath] = useState(null);
  const [preview, setPreview] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  /**
   * 处理文件选择：点击文件后调用 API 路由获取文件预览内容
   */
  const handleFileSelect = async (file) => {
    if (file.type !== 'blob') return;
    setSelectedPath(file.path);
    setLoadingPreview(true);
    setPreview('');
    try {
      const res = await fetch(
        `/api/preview?path=${encodeURIComponent(
          file.path
        )}&ref=${defaultBranch}`
      );
      if (!res.ok) {
        const errText = await res.text();
        setPreview(`Error: ${errText}`);
      } else {
        const data = await res.json();
        setPreview(data.content);
      }
    } catch (e) {
      setPreview(`Error: ${e.message}`);
    }
    setLoadingPreview(false);
  };

  if (error) {
    return (
      <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
        <h1>加载仓库数据错误</h1>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {/* 左侧：文件树区域 */}
      <div
        style={{
          flex: '1',
          overflow: 'auto',
          padding: '20px',
          borderRight: '1px solid #ddd',
        }}
      >
        <h2>仓库文件树</h2>
        {treeData && treeData.length > 0 ? (
          treeData.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              onFileSelect={handleFileSelect}
              initialPath={initialPath}
            />
          ))
        ) : (
          <p>没有目录数据可显示。</p>
        )}
      </div>
      {/* 右侧：文件预览区域 */}
      <div style={{ flex: '2', overflow: 'auto', padding: '20px' }}>
        <h2>预览 {selectedPath ? `- ${selectedPath}` : '（未选择文件）'}</h2>
        {loadingPreview ? (
          <p>加载预览…</p>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap' }}>{preview}</pre>
        )}
      </div>
    </div>
  );
}

/**
 * getServerSideProps 在服务端调用 GitHub API 获取仓库信息及完整树结构
 * 同时解析环境变量 GITHUB_ROUTE 支持初始路径设置：
 *  - 格式为 "owner/repo" 或 "owner/repo/child/folder"，多出的部分作为初始展开路径。
 */
export async function getServerSideProps() {
  // 从环境变量中读取 GitHub 用户令牌和路径设置
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

  // 前两个部分为仓库拥有者和仓库名称，多余部分作为初始展开路径
  const owner = routeParts[0];
  const repo = routeParts[1];
  const initialPath = routeParts.length > 2 ? routeParts.slice(2).join('/') : '';

  const headers = {
    Authorization: `token ${githubUserToken}`,
    Accept: 'application/vnd.github.v3+json',
  };

  try {
    // ① 获取仓库基本信息（获取默认分支）
    const repoResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers }
    );
    if (!repoResponse.ok) {
      const errorData = await repoResponse.json();
      return {
        props: { error: errorData.message || '无法获取仓库信息' },
      };
    }
    const repoData = await repoResponse.json();
    const defaultBranch = repoData.default_branch || 'main';

    // ② 获取分支信息，获得树对象的 SHA 值
    const branchResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`,
      { headers }
    );
    if (!branchResponse.ok) {
      const errorData = await branchResponse.json();
      return {
        props: {
          error: errorData.message || '无法获取分支信息',
        },
      };
    }
    const branchData = await branchResponse.json();
    const treeSha = branchData.commit.commit.tree.sha;

    // ③ 获取仓库完整的文件树（recursive=1 为递归获取所有目录和文件）
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
      { headers }
    );
    if (!treeResponse.ok) {
      const errorData = await treeResponse.json();
      return {
        props: {
          error: errorData.message || '无法获取树结构数据',
        },
      };
    }
    const treeDataJson = await treeResponse.json();

    // 过滤无效数据，并构建树形结构
    const treeItems = treeDataJson.tree.filter(
      (item) => item.path && item.mode
    );
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
