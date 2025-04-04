export default async function handler(req, res) {
    const { path, ref } = req.query;
  
    if (!path) {
      return res.status(400).json({ error: '缺少文件 path 参数' });
    }
  
    // 获取服务器端的 GitHub 用户令牌和仓库路径（格式："owner/repo"）
    const githubUserToken = process.env.GITHUB_USER_TOKEN;
    const githubRoute = process.env.GITHUB_ROUTE;
  
    if (!githubUserToken || !githubRoute) {
      return res
        .status(500)
        .json({ error: '服务器配置错误：缺少 GitHub 配置信息' });
    }
  
    const [owner, repo] = githubRoute.split('/');
  
    // 构造 GitHub 文件内容接口 URL
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref || 'main'}`;
  
    const headers = {
      Authorization: `token ${githubUserToken}`,
      Accept: 'application/vnd.github.v3.raw',
    };
  
    try {
      const response = await fetch(apiUrl, { headers });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }
      // 返回文件原始内容（文本格式）
      const content = await response.text();
      res.status(200).json({ content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
  