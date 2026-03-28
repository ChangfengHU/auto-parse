import { NextRequest, NextResponse } from 'next/server';
import { saveXhsPost } from '@/lib/content-storage';
import { uploadFromUrl } from '@/lib/oss';

/**
 * POST /api/content/save/xhs
 * 保存小红书内容到本地JSON，并上传图片到OSS
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    console.log('接收到保存请求:', JSON.stringify(body, null, 2));

    const {
      noteData,     // 解析出的小红书数据
      originalUrl   // 原始链接
    } = body;

    if (!noteData) {
      return NextResponse.json({ error: '缺少 noteData' }, { status: 400 });
    }

    // 保存到本地JSON
    const savedPost = saveXhsPost(noteData, originalUrl);
    console.log('小红书作品已保存到本地:', savedPost.id);

    // 处理图片上传
    const imageList = noteData.imageList || [];
    const uploadPromises = [];

    for (let i = 0; i < imageList.length; i++) {
      const imageInfo = imageList[i];
      
      // 异步上传到OSS
      const uploadPromise = uploadFromUrl(imageInfo.urlDefault, `xhs/${savedPost.id}/image_${i}.jpg`)
        .then((ossUrl) => {
          console.log(`图片 ${i + 1} 上传成功: ${ossUrl}`);
          return {
            index: i,
            originalUrl: imageInfo.urlDefault,
            ossUrl,
            status: 'success'
          };
        })
        .catch((error) => {
          console.error(`图片 ${i + 1} 上传失败:`, error);
          return {
            index: i,
            originalUrl: imageInfo.urlDefault,
            error: String(error),
            status: 'failed'
          };
        });
      
      uploadPromises.push(uploadPromise);
    }

    // 启动异步上传，不等待完成
    Promise.all(uploadPromises).then((results) => {
      console.log('所有图片上传完成:', results);
    });

    return NextResponse.json({
      success: true,
      data: {
        post: savedPost,
        message: `✅ 小红书内容已保存到本地！作品ID: ${savedPost.id}，${imageList.length} 张图片正在上传中...`
      }
    });

  } catch (error) {
    console.error('保存小红书内容失败:', error);
    return NextResponse.json({ 
      error: `保存失败: ${String(error)}` 
    }, { status: 500 });
  }
}