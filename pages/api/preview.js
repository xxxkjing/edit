export default async function handler(req, res) {
  const { path, ref } = req.query;

  if (!path) {
    return res.status(400).json({ error: '缺少文件 path 参数' });
  }

  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE;

  if (!githubUserToken || !githubRoute) {
    return res
      .status(500)
      .json({ error: '服务器配置错误：缺少 GitHub 配置信息' });
  }

  const [owner, repo] = githubRoute.split('/');
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

    // 根据文件扩展名判断处理方式
    let extension = '';
    if (path.includes('.')) {
      extension = path.split('.').pop().toLowerCase();
    }
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    const textFileExts = ['js', 'json', 'css', 'html', 'md', 'txt', 'xml', 'csv', 'log'];

    if (imageExts.includes(extension)) {
      // 图片文件：读取为二进制，转换为 base64
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      let mimeType = 'image/jpeg';
      if (extension === 'png') mimeType = 'image/png';
      else if (extension === 'gif') mimeType = 'image/gif';
      else if (extension === 'bmp') mimeType = 'image/bmp';
      else if (extension === 'webp') mimeType = 'image/webp';
      return res.status(200).json({
        content: base64,
        mimeType,
        isImage: true,
        isBinary: false,
      });
    } else if (textFileExts.includes(extension)) {
      // 文本文件：直接以文本方式返回
      const content = await response.text();
      return res.status(200).json({
        content,
        isImage: false,
        isBinary: false,
      });
    } else {
      // 其他情况：认为是二进制文件，无法预览
      return res.status(200).json({
        content: '二进制文件无法预览',
        isImage: false,
        isBinary: true,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
