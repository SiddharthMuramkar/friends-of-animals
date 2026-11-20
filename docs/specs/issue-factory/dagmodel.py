import json, collections, sys

# ---------- native-edge fit (issue level): issue -> blockers ----------
NAT = {
 57:[],58:[57],59:[57],60:[59],61:[57],62:[60],63:[59,61],64:[59,61],65:[57],66:[],67:[],68:[63],
 69:[61],70:[60],71:[70,61],72:[70,64],73:[59,69],74:[73],75:[74,71],76:[75],77:[75,72],78:[77],79:[77],
 80:[79,60],81:[78,69],82:[81,72],83:[82,75,63],
 84:[69,75,78,81],85:[63,78,71],86:[85],87:[85,74],88:[71],89:[87,88,69],90:[89],91:[89],92:[89,71],
 93:[92],94:[93],95:[94,88],96:[95],97:[96,94],98:[97],
 99:[97,82],100:[99],101:[100],102:[100],103:[102,82,99],104:[103],
 105:[80],106:[105],107:[106],108:[106,63],109:[105,60],110:[106,109],111:[64],112:[111,85],113:[69,59],
 114:[62,61],115:[81,63],116:[69],117:[80,92,93,99,100],118:[],
 119:[99],120:[119,99],121:[119,73],122:[119,62],123:[81,59],124:[123,119],125:[111,69,59],126:[64,69],
 127:[59,60],128:[127],129:[127],130:[129,69],131:[92,60],132:[131],133:[132,105],134:[69,75],135:[117],
}
dep = {d['n']:d for d in json.load(open(sys.argv[1]))}
bl = collections.Counter()
for k,v in NAT.items():
    for b in v: bl[b]+=1
mm=[]
for n in range(57,136):
    tb=dep[n]['tb']; b2=dep[n]['bl']
    if len(NAT[n])!=tb or bl[n]!=b2: mm.append((n,len(NAT[n]),tb,bl[n],b2))
print('native mismatches (n, fit_tb, tb, fit_bl, bl):', mm, 'edges', sum(len(v) for v in NAT.values()))

# ---------- units: id -> (ms, size, tourn, judges, blockers) ----------
U = {}
def u(i, ms, size, t, j, *b): U[i]=dict(ms=ms,size=size,t=t,j=j,b=list(b))
# M0
u('57a',0,'L','P',3)
u('57b',0,'L','B3',3,'57a')
u('57c',0,'M','N',3,'57b')
u('58',0,'L','B2',3,'57b')
u('59a',0,'L','B2',3,'57b')
u('59b',0,'L','N',3,'59a')
u('60',0,'L','B2',3,'59a')
u('61a',0,'L','B2',1,'57b')
u('61b',0,'L','N',1,'61a')
u('62',0,'M','N',3,'60')
u('63a',0,'L','B2',3,'59a','61a')
u('63b',0,'L','N',3,'63a')
u('63c',0,'M','N',3,'63b')
u('64',0,'L','B2',3,'59a','61a')
u('65',0,'L','B3',3,'57b')
u('66a',0,'M','N',1,'57a')
u('66b',0,'M','N',1,'61b','66a')
u('68',0,'M','N',1,'63a','61a','66a')
# M1
u('69',1,'L','B2',3,'61a','58','59a','60','62','64')
u('70a',1,'L','N',3,'60','59a')
u('70b',1,'M','B2',3,'70a','65')
u('71',1,'L','B2',1,'70a','61a')
u('72',1,'L','B2',3,'70a','64')
u('73',1,'L','P',3,'59a','69','58','60')
u('74',1,'L','P',3,'73','58')
u('75a',1,'M','N',3,'74','71')
u('75b',1,'L','B2',3,'75a','58','69')
u('76',1,'M','N',3,'75b')
u('77a',1,'L','B3',3,'75b','72')
u('77b',1,'L','N',3,'77a','65')
u('77c',1,'M','N',3,'77b','76')
u('78',1,'L','P',3,'77a','58')
u('79',1,'L','P',3,'77a','63a','60')
u('80a',1,'L','B3',3,'79','60')
u('80b',1,'M','N',3,'80a','71')
u('81a',1,'L','B3',3,'78','69','58')
u('81b',1,'L','B2',3,'81a')
u('82',1,'L','B3',3,'81b','72','64')
u('83a',1,'L','B3',3,'82','75b','63a','60','65','69')
u('83b',1,'L','B2',3,'82','75b','63a')
# M2
u('84a',2,'L','B2',3,'69','75b','78','81b','59a','61a','70a','77a')
u('84b',2,'L','B2',3,'85b','61a','62','69','71','81b')
u('85a',2,'L','B3',3,'61a','63b')
u('85b',2,'L','B2',3,'85a','59a','63a','65','69','71','73','78','81b')
u('86a',2,'L','B2',3,'85a','85b')
u('86b',2,'M','B2',3,'85b')
u('87',2,'M','N',3,'85b','69','74','75b','77a','81b')
u('88',2,'L','B2',1,'71','59a','69','70a')
u('89a',2,'L','B2',3,'88','87','85b','70a','74','75b','69')
u('89b',2,'M','N',3,'89a','87','69','81b')
u('90',2,'L','B2',1,'89b','84b','88','71')
u('91a',2,'L','P',3,'89b','87','85b','70a')
u('91b',2,'M','P',3,'91a')
u('92',2,'L','P',3,'89b','85b','59a','60','62','63a','69','71','81b')
# M3
u('93',3,'L','P',3,'92','61a','62','69','70a','73','74','81b','84b')
u('94',3,'L','B2',3,'93','63a','85a','92','62')
u('95a',3,'M','N',3,'94','88','72')
u('95b',3,'L','B2',3,'95a','57b','59a','60','64','69','74','81b','92')
u('95c',3,'M','B2',3,'95b','94')
u('96',3,'L','B3',3,'95c','63a','85a','86a','86b','88')
u('97',3,'L','B2',3,'96','94','59a','60','72')
u('98',3,'M','N',1,'97')
# M4
u('99a',4,'L','B2',3,'97','82','60','61a','69','70a','72','81b','83a','83b')
u('99b',4,'M','B2',3,'99a','65','70b')
u('100a',4,'L','B2',3,'99a','57b','61a','63a','69','73','81b','85a','89b','91a','97')
u('100b',4,'M','N',3,'100a')
u('100c',4,'L','B2',3,'100a','85a')
u('101',4,'L','P',3,'100a','100b','100c','60','61a','63a','69','74','75b','81b')
u('102',4,'L','B2',3,'100a','100b','100c','63a','85a')
u('103a',4,'L','B3',3,'102','82','99b','62','63a','65','83a','83b','89b','97','85a')
u('103b',4,'M','B2',3,'103a')
u('103c',4,'M','N',3,'103a')
u('103d',4,'M','N',3,'103a','99b')
u('104',4,'M','N',3,'103a','103b','103c','103d','82','102')
# M5
u('105',5,'L','B3',3,'80a','77a','79','61a','59a','60')
u('106a',5,'L','B2',3,'105','77a','80a','81b','62','69')
u('106b',5,'L','B2',3,'106a','77b','65')
u('107',5,'L','B2',3,'106a','106b','69','80a')
u('108',5,'L','P',3,'106a','106b','63a','60','62')
u('109a',5,'L','B2',3,'105','60','62')
u('109b',5,'M','N',3,'105','109a')
u('110a',5,'L','B2',3,'106a','109a','65')
u('110b',5,'M','N',3,'110a','106b','109a','109b')
u('111a',5,'L','B3',3,'59a','60','64','65')
u('111b',5,'L','B2',3,'111a')
u('112a',5,'L','B2',3,'111a','63a','85a','61a')
u('112b',5,'L','B2',3,'112a','111b')
u('113',5,'L','B2',3,'69','59a','60','57b','65')
u('114',5,'L','B3',3,'62','61a','59a','73')
u('115a',5,'L','P',3,'114','81b','59a','60','69','63a')
u('115b',5,'L','B3',3,'115a','114','63a','61a','64','82')
u('116a',5,'L','B3',3,'59a','60','69','57b')
u('116b',5,'M','N',3,'59a','60','69','81b')
u('117a',5,'M','N',3,'59a','73','80b','92','93','99a','100a','103c')
u('117b',5,'L','P',3,'75b','77a','78','85b','89b','92','100a','105')
u('118',5,'M','P',3,'65','57a')
# M6
u('119',6,'L','B2',3,'99a','81b','61a','59a','114','57b','89b','97','100a')
u('120',6,'M','N',3,'119','99a','69','64','82','81b','61a','121','123','125a')
u('121',6,'M','N',3,'119','73','74','75b','81b','62','69','59a')
u('122',6,'M','N',3,'119','62','69','59a')
u('123',6,'L','P',3,'59a','60','62','64','81b','75b','69','114')
u('124',6,'L','B2',3,'123','119','100b','100c','61a','69')
u('125a',6,'M','N',3,'111a','69','59a','114')
u('125b',6,'L','B2',3,'125a','84b','81b','61a','69')
u('125c',6,'M','N',3,'125b','119')
u('126',6,'L','B2',3,'64','82','81b','69','61a','119','59a')
# M7
u('127',7,'L','P',3,'59a','60','63a','75b','69','114')
u('128',7,'M','N',3,'127')
u('129',7,'L','N',1,'127','63a','85a','111a','59a')
u('130',7,'L','B2',3,'129','127','69','64','59a','75b','81b','114')
# M8
u('131',8,'L','B2',3,'94','82','83a','83b','70a','97','99a','102','103a','73','61a','59a','60','92')
u('132',8,'L','B3',3,'131','81b','75b','69','62','61a','114')
u('133a',8,'L','B3',3,'132','77a','79','105','109a','94','69','81b','73','100c','72')
u('133b',8,'M','N',3,'133a','94','100c','81b','73')
u('134',8,'L','B2',3,'99a','64','82','81b','69','74','75b','78','117b','114','59a')
u('135a',8,'M','N',3,'117a','117b','59a','60')
u('135b',8,'M','N',3,'117a','117b','119','121','122','125c','73','75b','78')
u('135c',8,'M','N',3,'124','134','135a','135b','110a','106b','107','108')

DONE={'67'}
for k,v in U.items():
    for b in v['b']:
        assert b in U or b in DONE, (k,b)
print('units', len(U)+1, 'to implement', len(U))
# cycle / topo
order=[]; seen={}
def visit(n):
    if seen.get(n)==1: raise Exception('cycle '+n)
    if seen.get(n)==2: return
    seen[n]=1
    for b in U[n]['b']: visit(b)
    seen[n]=2; order.append(n)
for n in U: visit(n)

# ---------- effort model ----------
IMPL={'S':1,'M':2,'L':5}
ACS={'S':3,'M':4,'L':6}
def ah(n, t=None, j=None):
    x=U[n]; I=IMPL[x['size']]; t=t or x['t']; j=j or x['j']
    harden=0.4; paper=0.9 if t in('P','B2','B3') else 0
    k={'B2':2,'B3':3}.get(t,0)
    impl=(0.6*k+0.4)*I if k else I
    pj=k*(k-1)*0.2
    gates=0.2
    review=j*0.2+ACS[x['size']]*0.1+(0.02 if j==3 else 0)
    fix=0.25*I+0.1*j
    mq=0.4; runner=0.4
    return harden+paper+impl+pj+gates+review+fix+mq+runner
WALL={'S':3,'M':4.5,'L':7.5}
def wall(n):
    x=U[n]; w=WALL[x['size']]
    if x['t'] in('B2','B3'): w+=2.0
    elif x['t']=='P': w+=0.75
    return w
tot=sum(ah(n) for n in U)
print('AH total units', round(tot,1), 'with 15% retries', round(tot*1.15,1))
c=collections.Counter((U[n]['size']) for n in U); print('sizes',c)
c=collections.Counter((U[n]['t']) for n in U); print('tourn',c)
c=collections.Counter((U[n]['j']) for n in U); print('judges',c)
protos=sum({'B2':2,'B3':3}.get(U[n]['t'],0) for n in U); print('proto branches',protos)
# longest path units & wall & ah
LPu={};LPw={};LPa={};prev={}
for n in order:
    bs=[b for b in U[n]['b'] if b in U]
    if bs:
        bu=max(bs,key=lambda b:LPw[b]); prev[n]=bu
        LPu[n]=1+max(LPu[b] for b in bs); LPw[n]=wall(n)+LPw[bu]; LPa[n]=ah(n)+LPa[bu]
    else: LPu[n]=1;LPw[n]=wall(n);LPa[n]=ah(n)
end=max(U,key=lambda n:LPw[n]); path=[end]
while path[-1] in prev: path.append(prev[path[-1]])
path.reverse()
print('critical path (wall)', len(path), round(LPw[end],1),'h', round(LPa[end],1),'AH', ' > '.join(path))
endu=max(U,key=lambda n:LPu[n]); print('max units depth', LPu[endu], endu)

# ---------- conflict groups (same wave forbidden) ----------
CG = {
 'proxy': ['57b','58','60','65','70b','112b'],
 'layout': ['65','66a','118'],
 'csp-headers': ['65','63a','77b','106b','118','128','103a','70b'],
 'harness': ['57a','58','61a','63a','128'],
 'workers-yml': ['61b','63b','66b','68','85a','86a','100c','102'],
 'header': ['57b','59b','69','73','78','81a'],
 'roles-enum': ['92','115a','116a','95b'],
 'ci-yml': ['132'],
 'competitions': ['70a','71','72','80b'],
 'payments': ['77a','77b','78','79','80a','106a','133a'],
 'school-round': ['89a','89b','90','91a'],
 'home-gallery': ['111b','103a'],
}
grp=collections.defaultdict(set)
for g,ms in CG.items():
    for m in ms: grp[m].add(g)
# ---------- rolling-wave schedule W=6 ----------
W=6; done=set(DONE); waves=[['57a']]; done.add('57a')
remaining=set(U)-{'57a'}
while remaining:
    ready=[n for n in remaining if all(b in done for b in U[n]['b'])]
    # priority: longest remaining path (downstream), computed by reverse
    ready.sort(key=lambda n:(-down[n] if 'down' in globals() else 0, n))
    pick=[];used=set()
    for n in ready:
        if len(pick)==W: break
        if grp[n] & used: continue
        pick.append(n); used|=grp[n]
    if not pick: raise Exception('stuck')
    waves.append(pick); done|=set(pick); remaining-=set(pick)
    if 'down' not in globals():
        # compute downstream longest path once then restart
        succ=collections.defaultdict(list)
        for k,v in U.items():
            for b in v['b']:
                if b in U: succ[b].append(k)
        down={}
        for n in reversed(order):
            down[n]=wall(n)+max([down[s] for s in succ[n]] or [0])
        done=set(DONE)|{'57a'}; waves=[['57a']]; remaining=set(U)-{'57a'}
print('waves', len(waves))
cum=0
for i,w in enumerate(waves):
    a=sum(ah(n) for n in w); cum+=a
    print(i, round(a,1), round(cum,1), ' '.join(f"{n}(M{U[n]['ms']})" for n in w))
json.dump(dict(waves=waves, ah={n:round(ah(n),1) for n in U}, wall={n:wall(n) for n in U}, path=path), open(sys.argv[2],'w'))

# ---------- transitive reduction for the doc ----------
anc={}
for n in order:
    s=set()
    for b in U[n]['b']:
        if b in U: s|={b}|anc[b]
    anc[n]=s
red={}
for n in U:
    bs=[b for b in U[n]['b'] if b in U]
    red[n]=[b for b in bs if not any(b in anc[c] for c in bs if c!=b)]
    if '67' in U[n]['b']: red[n].append('67')
json.dump(red, open('dagmodel-red.json','w'))

# ---------- levers on the critical path ----------
def cp(wallf, U2):
    LP={};pv={}
    for n in order:
        bs=[b for b in U2[n] if b in U]
        if bs:
            bu=max(bs,key=lambda b:LP[b]); pv[n]=bu; LP[n]=wallf(n)+LP[bu]
        else: LP[n]=wallf(n)
    e=max(U,key=lambda n:LP[n]); p=[e]
    while p[-1] in pv: p.append(pv[p[-1]])
    return LP[e], p[::-1]
base={n:U[n]['b'] for n in U}
rep=dict(base); rep['95a']=['88','72','93']; rep['102']=['100a','85a']
def wall_ahead(n):
    x=U[n]; w=WALL[x['size']]-0.5
    if x['t'] in('B2','B3'): w+=1.25
    return w
for name,wf,UU in [('base',wall,base),('repoint',wall,rep),('repoint+ahead',wall_ahead,rep)]:
    L,p=cp(wf,UU); print('CP',name,round(L,1),'h',len(p),'units',round(sum(ah(n) for n in p),1),'AH',' > '.join(p))

# ---------- ladder ----------
KEEP_BUILD={'57b','58','59a','60','65','63a','77a','80a','81a','82','83a','105','106a','109a','103a','111a','114','115b','116a','132','133a','85a','96'}
def total(tf=lambda n:U[n]['t'], jf=lambda n:U[n]['j'], units=None):
    return sum(ah(n,tf(n),jf(n)) for n in (units or U))
t0=total()
t1=total(tf=lambda n: U[n]['t'] if (U[n]['t'] in('N','P') or n in KEEP_BUILD) else 'P')
t2=total(tf=lambda n: ('B2' if U[n]['t']=='B3' else U[n]['t']) if (U[n]['t'] in('N','P') or n in KEEP_BUILD) else 'P')
print('ladder AH', round(t0), round(t1), round(t2))
m68=[n for n in U if U[n]['ms']>=6]
t4=sum(ah(n,('B2' if U[n]['t']=='B3' else U[n]['t']) if (U[n]['t'] in('N','P') or n in KEEP_BUILD) else 'P') for n in U if n not in m68)
print('ladder defer M6-M8', round(t4), 'units deferred', len(m68))

# ---------- per milestone ----------
for m in range(9):
    us=[n for n in U if U[n]['ms']==m]
    print('M',m,len(us),round(sum(ah(n) for n in us),1),'protos',sum({'B2':2,'B3':3}.get(U[n]['t'],0) for n in us))
for t in ['N','P','B2','B3']:
    for j in [1,3]:
        us=[n for n in U if U[n]['t']==t and U[n]['j']==j]
        if us: print(t,j,len(us))

# ---------- event simulation ----------
import heapq
def sim(W_after=6, A7=None, used0=0.45, week_starts=(84.5,252.5,420.5), orch=4.0, retry=0.15, dry_hours=24):
    # times in hours from Day1 00:00 IST
    succ=collections.defaultdict(list)
    for k,v in U.items():
        for b in v['b']:
            if b in U: succ[b].append(k)
    merged=set(DONE); running={}; t=0.0; qfree=0.0
    started={}; finish={}; usage=collections.defaultdict(float)
    pending=set(U)
    events=[]
    def ready(n): return all(b in merged for b in U[n]['b'])
    week=[0]+list(week_starts)
    def wk(tt): return sum(1 for s in week if tt>=s)-1
    wkused=collections.defaultdict(float)
    cap={0:(0.85-used0)*A7 if A7 else 1e9}
    for i in range(1,len(week)): cap[i]=0.85*A7 if A7 else 1e9
    step=0.25
    inflight=set(); done_run={}
    while pending or inflight or done_run:
        # finish runs
        for n in list(inflight):
            if t>=started[n]+wall(n)*1.0:
                inflight.discard(n); qs=max(qfree,t); qfree=qs+0.5; done_run[n]=qfree
        for n,tm in list(done_run.items()):
            if t>=tm: merged.add(n); finish[n]=tm; del done_run[n]
        W = 3 if t<dry_hours else W_after
        w=wk(t)
        # weekly pacing: allow start if used < cap*(elapsed fraction)+10% of cap
        wlen=(week[w+1] if w+1<len(week) else week[w]+168)-week[w]
        frac=(t-week[w])/wlen
        pace = cap[w]*min(1.0,frac+0.12)
        cands=sorted([n for n in pending if ready(n)], key=lambda n:-down[n])
        used_groups=set().union(*[grp[m] for m in inflight]) if inflight else set()
        for n in cands:
            if len(inflight)>=W: break
            committed=sum(ah(m)*(1+retry)*max(0.0,started[m]+wall(m)-t)/wall(m) for m in inflight)
            if wkused[w]+committed+ah(n)*(1+retry)*min(1.0,(wlen*(1-frac))/wall(n))>=cap[w]: break
            if wkused[w]>=pace: break
            if t<dry_hours and n not in ('57a','57b','66a'): continue
            if grp[n]&used_groups: continue
            inflight.add(n); started[n]=t; pending.discard(n); used_groups|=grp[n]
        # usage this step
        a=orch*step/24
        for n in inflight: a+=ah(n)*(1+retry)/wall(n)*step
        usage[int(t//24)+1]+=a; wkused[w]+=a
        t+=step
        if t>2000: break
    return finish, usage, started
down_ok = 'down' in globals()
for A7 in [None, 900, 700, 500]:
    fin,use,st=sim(A7=A7)
    end=max(fin.values()); 
    print('A7',A7,'finish day',round(end/24+1,2),'total AH',round(sum(use.values())))
    if A7 in (None,900):
        print(' per day', [ (d,round(v)) for d,v in sorted(use.items())])
        # milestone completion days
        for m in range(9):
            print('  M',m,'done day',round(max(fin[n] for n in U if U[n]['ms']==m)/24+1,1), 'first start day', round(min(st[n] for n in U if U[n]['ms']==m)/24+1,1))
        # units merged per day
        c=collections.Counter(int(v//24)+1 for v in fin.values()); print(' merged/day',sorted(c.items()))

# ---------- report for doc ----------
widx={n:i for i,w in enumerate(waves) for n in w}
fin,use,st=sim(A7=900)
cum=0
print('DAY TABLE A7=900')
for dday in range(1,18):
    a=use.get(dday,0); cum+=a
    s=[n for n in U if int(st[n]//24)+1==dday]
    m=[n for n in U if int(fin[n]//24)+1==dday]
    wv=sorted({widx[n] for n in s})
    print(dday, round(a), round(cum), 'start', len(s), 'merged', len(m), 'waves', (min(wv),max(wv)) if wv else '-', 'ms_done', [k for k in range(9) if int(max(fin[n] for n in U if U[n]['ms']==k)//24)+1==dday])
fin0,use0,st0=sim(A7=None)
print('unconstrained per day', [round(use0.get(d,0)) for d in range(1,18)])
# per-wave rows: AH, units with ms and reduced blockers
for i,w in enumerate(waves):
    print('W',i, round(sum(ah(n) for n in w),1), ', '.join(w))
# tickets
import re
tick=collections.OrderedDict()
for n in sorted(U, key=lambda x:(int(re.match(r'\d+',x).group()), x)):
    tick.setdefault(int(re.match(r'\d+',n).group()),[]).append(n)
for t,us in tick.items():
    print('T',t,'nat',NAT[t],'tb',dep[t]['tb'],'|', ' · '.join(f"{n} {U[n]['size']}/{U[n]['t']}/{U[n]['j']}j ← {','.join(red[n]) or '—'}" for n in us))
