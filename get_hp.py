import urllib.request
import json
import urllib.parse

req = urllib.request.Request('https://api4.thetvdb.com/v4/login', data=json.dumps({'apikey':'003b4e7b-87b7-4756-b227-bb241093216f'}).encode('utf-8'), headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['data']['token']

req2 = urllib.request.Request('https://api4.thetvdb.com/v4/series/433637/extended', headers={'Authorization': 'Bearer ' + token})
resp2 = urllib.request.urlopen(req2)
data = json.loads(resp2.read())['data']
print("Lists for HP Series:")
for l in data.get('lists', []):
    print(l['id'], l['name'])

print("---")
# also check HP Movie
req3 = urllib.request.Request('https://api4.thetvdb.com/v4/search?query=' + urllib.parse.quote('Harry Potter and the Sorcerer') + '&type=movie', headers={'Authorization': 'Bearer ' + token})
resp3 = urllib.request.urlopen(req3)
d3 = json.loads(resp3.read())['data'][0]
print("Movie ID:", d3['tvdb_id'])

req4 = urllib.request.Request('https://api4.thetvdb.com/v4/movies/' + str(d3['tvdb_id']) + '/extended', headers={'Authorization': 'Bearer ' + token})
resp4 = urllib.request.urlopen(req4)
d4 = json.loads(resp4.read())['data']
print("Lists for HP Movie:")
for l in d4.get('lists', []):
    print(l['id'], l['name'])

