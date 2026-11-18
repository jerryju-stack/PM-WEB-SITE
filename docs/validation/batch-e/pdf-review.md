# PDF 渲染与外部几何验收

2026-11-16，实际审阅 `pdf-contact.jpg` 的全部33页，并放大检查 `depth-20-page-9.png`、`long-range-page-1.png`（同一代码生成的其余首末页见证据目录）。PDFKit 负责产品生成，PDFPlumber 独立检查字符/绘制几何，Poppler 渲染。

- 合法层级1/3/15/16/20分别1/1/7/7/9页；空计划1页；跨2000–2100、2600工作日及长项目标题样本7页。任务标题均不超过200字，未用非法样本绕过契约。
- 深层名称列保留有效宽度，WBS/名称及长小数进度换行，不盖住邻列；第19/20层的完整长名称可见。层级缩进到42pt后封顶，字号仍可读。
- 页眉/页脚、重复表头和页码完整，最后行不压页脚；表格行与甘特矩形/里程碑中心对齐。空计划保留表头，不制造任务。
- 长项目标题换行，跨世纪范围保留全项目时间轴及首末里程碑；全部33页未发现裁切、重叠或缺字。长标题首行实际墨迹距顶32px，与深层标题相同；PDF字符上界26.616pt，非图像预览裁切造成的标题问题。
- 自动断言覆盖全部任务/项目标题Unicode、页面字符边界、实际行线与条/里程碑几何。见 `pdf-results.json`。JSON中的“require visual review”描述自动脚本的边界，本文件记录已经执行的人工视觉审阅，不将脚本自行宣称为视觉通过。

复用：`node --experimental-strip-types scripts/e-pdf-fixtures.ts .deploy/batch-e-pdf`，然后使用带 pdfplumber/Pillow 的 Python 运行 `scripts/validate-e-pdf.py .deploy/batch-e-pdf docs/validation/batch-e`；Poppler `pdftoppm` 须在PATH。PDF/全部中间PNG放忽略目录，仅提交接触表、代表性首末页和数值证据。新修改后须重新生成、检查及审阅，不沿用此结果。
