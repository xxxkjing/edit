export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: '仅支持 POST 请求' });
    }
  
    const { path, message, content, sha, branch } = req.body;
    if (!path || !message || content === undefined || !sha) {
      return res.status(400).json({ error: '缺失必要的参数' });
    }
  
    const githubUserToken = process.env.GITHUB_USER_TOKEN;
    const githubRoute = process.env.GITHUB_ROUTE;
    if (!githubUserToken || !githubRoute) {
      return res.status(500).json({ error: '服务器配置错误：缺少 GitHub 配置信息' });
    }
  
    const [owner, repo] = githubRoute.split('/');
  
    // 更新文件内容需要将新的内容进行 base64 编码
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');
  
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  
    const bodyData = {
      message,
      content: encodedContent,
      sha,
      branch: branch || 'main'
    };
  
    try {
      const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `token ${githubUserToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyData)
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        return res.status(response.status).json({ error: errorData });
      }
      
      const result = await response.json();
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  