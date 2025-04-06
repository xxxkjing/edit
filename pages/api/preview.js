export default async function handler(req, res) {
  const { path, ref } = req.query;

  if (!path) {
    return res.status(400).json({ error: '缺少文件 path 参数' });
  }

  const githubUserToken = process.env.GITHUB_USER_TOKEN;
  const githubRoute = process.env.GITHUB_ROUTE;

  if (!githubUserToken || !githubRoute) {
    return res.status(500).json({ error: '服务器配置错误：缺少 GitHub 配置信息' });
  }

  const [owner, repo] = githubRoute.split('/');
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref || 'main'}`;

  const headers = {
    Authorization: `token ${githubUserToken}`,
    // 请求原始数据
    Accept: 'application/vnd.github.v3.raw',
  };

  try {
    const response = await fetch(apiUrl, { headers });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    // 优先获得响应头中的 content-type 信息
    const headerContentType = response.headers.get('content-type') || '';

    // 根据文件路径提取扩展名（小写）
    let extension = '';
    if (path.includes('.')) {
      extension = path.split('.').pop().toLowerCase();
    }

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    const textFileExts = ['js', 'json', 'css', 'html', 'md', 'txt', 'xml', 'csv', 'log'];

    // 图片处理：如果扩展名属于图片类型，则读取为二进制，转换成 base64
    if (imageExts.includes(extension)) {
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
    }

    // 如果 HTTP 响应头明确标识为文本（如 text/* 或包含 charset），或者扩展名属于常见文本文件，则直接以文本方式读取
    if (
      headerContentType.toLowerCase().startsWith('text/') ||
      headerContentType.toLowerCase().includes('charset') ||
      textFileExts.includes(extension)
    ) {
      const textContent = await response.text();
      return res.status(200).json({
        content: textContent,
        isImage: false,
        isBinary: false,
      });
    }

    // 对于其他情况：先读取原始数据，再尝试使用 UTF-8 解码
    const buffer = await response.arrayBuffer();
    try {
      const textContent = new TextDecoder('utf-8', { fatal: true }).decode(
        new Uint8Array(buffer)
      );
      return res.status(200).json({
        content: textContent,
        isImage: false,
        isBinary: false,
      });
    } catch (e) {
      // 如果解码失败，则认为是二进制文件
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
