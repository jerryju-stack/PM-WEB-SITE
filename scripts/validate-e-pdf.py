"""External PDF text/geometry/render acceptance. Run with pdfplumber, Pillow and Poppler.
PDF generation and this validator deliberately use different libraries.
"""
import json, math, re, subprocess, sys
from pathlib import Path
import pdfplumber
from PIL import Image, ImageDraw

source=Path(sys.argv[1] if len(sys.argv)>1 else '.deploy/batch-e-pdf').resolve()
evidence=Path(sys.argv[2] if len(sys.argv)>2 else 'docs/validation/batch-e').resolve()
evidence.mkdir(parents=True,exist_ok=True)
manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
results=[]; thumbnails=[]
normalize=lambda text:re.sub(r'\s+','',text)
for case in manifest['cases']:
    pdf=source/(case['name']+'.pdf'); texts=[]; alignment=[]
    with pdfplumber.open(pdf) as document:
        for index,page in enumerate(document.pages):
            texts.append(''.join(c['text'] for c in page.chars))
            assert all(-.5<=c['x0']<=c['x1']<=page.width+.5 and -.5<=c['top']<=c['bottom']<=page.height+.5 for c in page.chars), 'Text outside page'
            headers=[r for r in page.rects if abs(r['x0']-26)<.1 and abs(r['height']-51)<.1]
            assert len(headers)==1,'Expected one shared table/Gantt header'
            body_top=headers[0]['bottom']
            bottoms=sorted(set(round(line['top'],3) for line in page.lines if abs(line['x0']-26)<.1 and abs(line['x1']-(page.width-26))<.2 and abs(line.get('linewidth',0)-.35)<.01))
            assert all(body_top<y<=page.height-51.9 for y in bottoms),'Body crosses footer'
            spans=list(zip([body_top]+bottoms[:-1],bottoms))
            bars=[r for r in page.rects if r['x0']>=635.9 and r['width']>0 and r['height']>0]
            for bar in bars:
                assert any(abs(bar['top']-(top+7))<.15 and abs(bar['bottom']-(bottom-7))<.15 for top,bottom in spans),'Table/Gantt rectangle row mismatch'
            diamonds=[c for c in page.curves if c['x0']>=635.9 and abs(c['height']-10)<.1 and abs(c['width']-10)<.1]
            for diamond in diamonds:
                assert any(abs((diamond['top']+diamond['bottom'])/2-(top+bottom)/2)<.15 for top,bottom in spans),'Milestone row mismatch'
            alignment.append({'page':index+1,'rows':len(spans),'bars':len(bars),'milestones':len(diamonds),'lastRowBottom':bottoms[-1] if bottoms else body_top})
        content=normalize(''.join(texts))
        for task in case['tasks']:
            assert normalize(task['title']) in content, 'Missing task title: '+case['name']+'/'+task['id']
        assert normalize(case['title']) in content,'Missing project title'
        page_count=len(document.pages)
    subprocess.run(['pdftoppm','-scale-to','1600','-png',str(pdf),str(source/(case['name']+'-page'))],check=True,capture_output=True)
    rendered=sorted(source.glob(case['name']+'-page-*.png'))
    assert len(rendered)==page_count
    for path in rendered:
        with Image.open(path) as image:
            thumb=image.convert('RGB');thumb.thumbnail((600,425));panel=Image.new('RGB',(620,465),'#ececf0');panel.paste(thumb,((620-thumb.width)//2,30));ImageDraw.Draw(panel).text((10,8),path.stem,fill='black');thumbnails.append(panel)
    if case['name'] in ['depth-20','long-range']:
        for path in [rendered[0],rendered[-1]]:
            with Image.open(path) as image:image.save(evidence/(path.stem+'.png'))
    results.append({'case':case['name'],'pages':page_count,'tasks':len(case['tasks']),'allTitlesExtracted':True,'withinPage':True,'rowAlignment':alignment})
columns=3;rows=math.ceil(len(thumbnails)/columns);sheet=Image.new('RGB',(620*columns,465*rows),'white')
for i,thumb in enumerate(thumbnails):sheet.paste(thumb,((i%columns)*620,(i//columns)*465))
sheet.save(evidence/'pdf-contact.jpg',quality=88)
(evidence/'pdf-results.json').write_text(json.dumps({'method':'PDFPlumber independent Unicode glyph extraction, page bounds and actual drawn table/Gantt row geometry; all pages rendered with Poppler. Contact sheet and selected full pages require visual review.','results':results},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'cases':len(results),'pages':sum(r['pages'] for r in results),'result':'text and geometry passed; render review pending'}))
