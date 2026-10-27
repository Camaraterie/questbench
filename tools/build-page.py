import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import markdown,re
md=open(os.path.join(ROOT,'DESIGN.md')).read()
md=re.sub(r'^# .*?\n\n\*.*?\*\n\n---\n','',md,flags=re.S)
parts=re.split(r'^## ',md,flags=re.M)[1:]
A='target="_blank" rel="noopener noreferrer"'
def render(txt):
    h=markdown.markdown(txt,extensions=['tables','sane_lists'])
    h=re.sub(r'(arXiv:(\d{4}\.\d{5}))',rf'<a href="https://arxiv.org/abs/\2" {A}>\1</a>',h)
    h=h.replace('<table>','<div class="table-container"><table class="table is-striped is-narrow is-fullwidth">').replace('</table>','</table></div>')
    h=re.sub(r'<h3>(.*?)</h3>',r'<h3 class="title is-4">\1</h3>',h)
    return h
secs=[]
for i,p in enumerate(parts):
    title,_,body=p.partition('\n')
    title=re.sub(r'^\d+\.\s*','',title.strip())
    if i==0: title='Abstract'
    cls='content has-text-justified' if i==0 else 'content'
    secs.append(f'''<section class="section"><div class="container is-max-desktop"><div class="columns is-centered"><div class="column is-four-fifths">
<h2 class="title is-3 has-text-centered">{title}</h2><div class="{cls}">{render(body)}</div></div></div></div></section>''')
def btn(href,icon,label): return f'<span class="link-block"><a href="{href}" {A} class="external-link button is-normal is-rounded is-dark"><span class="icon"><i class="{icon}"></i></span><span>{label}</span></a></span>'
links=''.join([btn('https://github.com/Camaraterie/questbench','fab fa-github','Code'),btn('scenarios.html','fas fa-scroll','Scenarios'),btn('https://github.com/MaxBittker/rs-sdk','fas fa-cube','rs-sdk'),btn('https://maxbittker.github.io/runebench/','fas fa-chart-bar','RuneBench'),btn('https://discord.gg/3DcuU5cMJN','fab fa-discord','Discord')])
tracks=''.join(f'<span class="tag is-medium is-light">{t}</span>' for t in ['A · Fellowship','B · Commons','C · Shadows','D · Relay','E · Mirror'])
html=f'''<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>QuestBench: Multi-Agent Cooperation &amp; Safety on RuneScape</title>
<link href="https://fonts.googleapis.com/css?family=Google+Sans|Noto+Sans|Castoro" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bulma@0.9.4/css/bulma.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
/* Design tokens: retheme here without touching structure */
:root{{ --font-body:'Noto Sans',sans-serif; --font-display:'Google Sans','Noto Sans',sans-serif;
 --link:hsl(204,86%,53%); --ink:#363636; --muted:#7a7a7a; --panel:#f5f5f5; --max:960px; }}
body{{font-family:var(--font-body);color:var(--ink)}}
.section{{padding:1.5rem 1.5rem}}
.hero>.hero-body{{padding-top:3rem;padding-bottom:0}}
.publication-title,.title,.publication-authors,.subtitle{{font-family:var(--font-display)}}
.publication-authors a{{color:var(--link)!important}} .author-block{{display:inline-block}}
.publication-links{{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}}
.link-block a{{margin:5px 0}}
.track-tags{{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:1rem}}
.content a{{color:var(--link)}} .content a:hover{{text-decoration:underline}}
.content h3.title{{margin-top:1.75rem;margin-bottom:.6rem}}
.content table{{font-size:.9rem}} .content table th{{white-space:nowrap}}
.content code{{font-size:.85em}}
.content blockquote{{background:var(--panel)}}
.footer{{background:var(--panel);padding:2rem 1.5rem 2.5rem}}
</style></head><body>
<section class="hero"><div class="hero-body"><div class="container is-max-desktop"><div class="columns is-centered"><div class="column has-text-centered">
<h1 class="title is-1 publication-title">QuestBench</h1>
<p class="subtitle is-3" style="margin-top:-0.5rem;margin-bottom:.75rem">Multi-Agent Cooperation &amp; Safety on RuneScape</p>
<div class="is-size-5 publication-authors"><span class="author-block">Christopher Camarata</span> · <span class="author-block has-text-grey">Design proposal v0.2 · working title · Oct 2026</span></div>
<div class="is-size-6 publication-authors has-text-grey" style="margin-top:.25rem">Built on <a href="https://github.com/MaxBittker/rs-sdk" {A}>rs-sdk</a> and <a href="https://maxbittker.github.io/runebench/" {A}>RuneBench</a> by Max Bittker</div>
<div class="column has-text-centered"><div class="publication-links">{links}</div></div>
<div class="track-tags">{tracks}</div>
</div></div></div></div></section>
{''.join(secs)}
<footer class="footer"><div class="container is-max-desktop"><div class="content has-text-centered is-size-7 has-text-grey">
<p>Unofficial community research proposal. Not affiliated with or endorsed by Jagex Ltd. or the rs-sdk / RuneBench maintainers. Page layout follows the RuneBench project page. Citations verified against arXiv abstracts.</p></div></div></footer>
</body></html>'''
open(os.path.join(ROOT,'docs','index.html'),'w').write(html)
