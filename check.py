import re

with open('gui/index.html', encoding='utf-8') as f:
    text = f.read()

m = re.search(r'<script>(.*)</script>', text, re.DOTALL)
script = m.group(1)
opened = script.count('{')
closed = script.count('}')
print(f'Braces: {opened} opened, {closed} closed')
