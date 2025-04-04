import React from 'react';

export default function Home({ envVars }) {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>调试：显示环境变量</h1>
      <p>
        <strong>GITHUB_USER_TOKEN:</strong>{' '}
        {envVars.GITHUB_USER_TOKEN || '未设置'}
      </p>
      <p>
        <strong>GITHUB_ROUTE:</strong> {envVars.GITHUB_ROUTE || '未设置'}
      </p>
      <hr />
      <p style={{ color: 'red' }}>
        注意：生产环境下请勿在页面上显示敏感信息！
      </p>
    </div>
  );
}

export async function getServerSideProps() {
  // 服务端读取环境变量，调试时将其传递到前端
  const envVars = {
    GITHUB_USER_TOKEN: process.env.GITHUB_USER_TOKEN || null,
    GITHUB_ROUTE: process.env.GITHUB_ROUTE || null,
  };

  return {
    props: { envVars }
  };
}


// import React from 'react';

// /**
//  * 将 GitHub API 返回的平面数组构建为树形结构
//  * @param {Array} flatList - GitHub 返回的包含 file/tree 对象的数组
//  * @returns {Array} 树形结构数据
//  */
// function buildTree(flatList) {
//   const tree = [];
//   const map = {};
  
//   // 遍历所有节点，为每个节点添加 children 数组并存入 map
//   flatList.forEach(item => {
//     item.children = [];
//     map[item.path] = item;
    
//     // 如果节点不含斜杠，即为顶级节点
//     if (!item.path.includes('/')) {
//       tree.push(item);
//     } else {
//       // 获取父级路径（注意：这里假设用 "/" 分隔）
//       const parts = item.path.split('/');
//       parts.pop(); // 去除当前节点名
//       const parentPath = parts.join('/');
//       if (map[parentPath]) {
//         map[parentPath].children.push(item);
//       } else {
//         // 如果父级未找到，作为顶级节点（防止异常数据）
//         tree.push(item);
//       }
//     }
//   });
  
//   return tree;
// }

// /**
//  * 递归组件：用于展示文件/文件夹节点
//  */
// function TreeNode({ node }) {
//   // 若当前节点含有子节点，则支持点击展开/收起
//   const [expanded, setExpanded] = React.useState(false);
//   const hasChildren = node.children && node.children.length > 0;
  
//   return (
//     <div style={{ marginLeft: '20px' }}>
//       <div
//         onClick={() => {
//           if (hasChildren) setExpanded(!expanded);
//         }}
//         style={{
//           cursor: hasChildren ? 'pointer' : 'default',
//           userSelect: 'none'
//         }}
//       >
//         {hasChildren ? (expanded ? '[-] ' : '[+] ') : '    '}
//         {node.type === 'tree' ? '📁' : '📄'} {node.path.split('/').pop()}
//       </div>
//       {expanded && hasChildren &&
//         node.children
//           .sort((a, b) => {
//             // 可选：先显示文件夹后显示文件，再按名称排序
//             if (a.type === b.type) return a.path.localeCompare(b.path);
//             return a.type === 'tree' ? -1 : 1;
//           })
//           .map(child => <TreeNode key={child.path} node={child} />)
//       }
//     </div>
//   );
// }

// /**
//  * 主页面组件：展示仓库目录结构
//  */
// export default function Home({ treeData, error }) {
//   // 当接口返回错误时直接显示错误信息
//   if (error) {
//     return (
//       <div style={{ padding: '20px' }}>
//         <h1>加载仓库数据错误</h1>
//         <p>{error}</p>
//       </div>
//     );
//   }
  
//   return (
//     <div style={{ padding: '20px' }}>
//       <h1>GitHub 仓库目录结构</h1>
//       {treeData && treeData.length > 0 ? (
//         treeData.map(node => <TreeNode key={node.path} node={node} />)
//       ) : (
//         <p>没有目录数据可显示。</p>
//       )}
//     </div>
//   );
// }

// /**
//  * getServerSideProps 在服务端调用 GitHub API 接口获取仓库文件树
//  */
// export async function getServerSideProps(context) {
//   // 从环境变量中读取配置信息：GITHUB_USER_TOKEN 和 GITHUB_ROUTE
//   const githubUserToken = process.env.GITHUB_USER_TOKEN;
//   const githubRoute = process.env.GITHUB_ROUTE; // 格式： "owner/repo"
  
//   if (!githubUserToken || !githubRoute) {
//     return {
//       props: {
//         error: '环境变量 GITHUB_USER_TOKEN 或 GITHUB_ROUTE 未设置'
//       }
//     };
//   }
  
//   // 拆分 GITHUB_ROUTE，得到仓库拥有者和仓库名称
//   const routeParts = githubRoute.split('/');
//   if (routeParts.length !== 2) {
//     return {
//       props: {
//         error: '环境变量 GITHUB_ROUTE 格式错误，应为 "owner/repo"'
//       }
//     };
//   }
  
//   const [owner, repo] = routeParts;
//   const headers = {
//     'Authorization': `token ${githubUserToken}`,
//     'Accept': 'application/vnd.github.v3+json'
//   };
  
//   try {
//     // ① 获取仓库基本信息，主要用来获取默认分支
//     const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
//     if (!repoResponse.ok) {
//       const errorData = await repoResponse.json();
//       return {
//         props: {
//           error: errorData.message || '无法获取仓库信息'
//         }
//       };
//     }
//     const repoData = await repoResponse.json();
//     const defaultBranch = repoData.default_branch || 'main';
    
//     // ② 获取默认分支的详细信息，得到树结构的 SHA 值
//     const branchResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}`, { headers });
//     if (!branchResponse.ok) {
//       const errorData = await branchResponse.json();
//       return {
//         props: {
//           error: errorData.message || '无法获取分支信息'
//         }
//       };
//     }
//     const branchData = await branchResponse.json();
//     const treeSha = branchData.commit.commit.tree.sha;
    
//     // ③ 获取仓库文件树（recursive=1 表示递归获取全部目录和文件）
//     const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { headers });
//     if (!treeResponse.ok) {
//       const errorData = await treeResponse.json();
//       return {
//         props: {
//           error: errorData.message || '无法获取树结构数据'
//         }
//       };
//     }
//     const treeDataJson = await treeResponse.json();
    
//     // 过滤掉无效数据，并构建树结构
//     const treeItems = treeDataJson.tree.filter(item => item.path && item.mode);
//     const tree = buildTree(treeItems);
    
//     return {
//       props: {
//         treeData: tree
//       }
//     };
//   } catch (err) {
//     return {
//       props: {
//         error: err.message || '数据获取出现异常'
//       }
//     };
//   }
// }
