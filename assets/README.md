# Timing 文件资源

- `Timing_Sample_v3_Print.xlsx`：用户提供的原始模板，未重建；模板下载返回原始字节。
- `fonts/NotoSansCJKsc-Regular.otf`：Noto Sans CJK SC Regular，来自 [Noto CJK 官方仓库](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)。PDF 按实际字形嵌入子集，支持中文检索和跨平台显示。许可证见 `fonts/OFL.txt`。

运行环境仍为 Node.js 24+。Excel 使用 fflate 处理 ZIP、对原 OOXML 做定点修改；PDF 使用 pdfkit。服务器不需要安装 Excel、Python 或 LibreOffice。
