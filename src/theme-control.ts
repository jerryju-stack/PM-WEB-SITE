const themeOptions = [['system','跟随系统'],['light','浅色'],['dark','深色']];

export function themeControl() {
  const preference = document.documentElement.dataset.themePreference ?? 'system';
  return '<label class="theme-control" lang="zh-CN"><span>外观</span><select aria-label="外观" data-theme-control>'+
    themeOptions.map(([value,label])=>'<option value="'+value+'"'+(value===preference?' selected':'')+'>'+label+'</option>').join('')+
    '</select></label>';
}
