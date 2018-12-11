/* chatterbox-v2.x.x-server.js
Source code for my Chatterbox server, developed over a span of ~2-3 years (2015-2017)

Note that if you try to run this code, it will NOT work. Don't try to do it.
There's too many outdated dependencies and obscure requirements, as well as keys to one of many other servers unrelated to this one that the server's linked to some where (which are either stored separately or redacted from this file)
Other than that, this code is untouched, so you can see just how bad middle-school me was at making servers! 

Pros of server: 
- Surprisingly good anti-spam features
- Colors, themes, and ranks - lots of customization
- Moderation tools (on top of anti-spam, /kick, /ban, etc.)

Cons of server: 
- Shockingly high number of dependencies, some of which are other projects I've made, some of which are online, etc. 
- A combination of auth methods, each of which is half broken, along with half-broken token authentication (which appears to be good enough to prevent hacking..?)
- Half the code is wrapped under the io.on(...) function
- If that wasn't enough, the entire codebase is under one massive try {...} catch (e){}
- Relies on dependencies that have been discontinued for years and are known to be insecure
- To put it lightly, it's almost as bad as the JDE codebase
*/


var version = '2.0.0';
var devBuild = true; //Turn on to send the non-minified client script to users instead of the minified script
var bcrypt = require('bcrypt');
//var md5 = require('md5');
var taffy = require('taffydb').taffy;
var jsonfile = require('jsonfile');
var path = require('path');
var request = require('request');

var force_reset_profiles = false;
var confirmation = '30'; //dd
var d = new Date();
if (d.getDate() !== parseInt(confirmation) && force_reset_profiles) {
  force_reset_profiles = false;
  console.log('\u001b[33mWarn\u001b[0m: Force reset profiles confirmation code invalid; not resetting profiles');
}

var spamFilter = true; //Set to false to disable the more extreme spam filters

var log = {
  full: [],
  partial: [],
  partial_ext: []
}

var colors_console = {
  black: '\u001b[30m',
  gray: '\u001b[90m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  magenta: '\001b[35m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  reset: '\u001b[0m'
};

function replaceAll(str, x, y) {
  if (typeof str === 'string' && typeof x === 'string') {
    while (str.indexOf(x) !== -1) {
      str = str.replace(x, y);
    }
    return str;
  }
}

function hexToRgb(hex) {
  // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
  var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, function (m, r, g, b) {
    return r + r + g + g + b + b;
  });

  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function getIP(i) {
  i = i.substring(2);
  if (i === '1') {
    return 'localhost'
  } else if (i.slice(0, 4) === 'ffff') {
    return i.substring(5);
  } else {
    return i
  }
}

function padZero(num, d) {
  var numDigits = isNaN(d) ? 2 : d;
  var n = Math.abs(num);
  var zeros = Math.max(0, numDigits - Math.floor(n).toString().length);
  var zeroString = Math.pow(10, zeros).toString().substr(1);
  return zeroString + n;
}

function getTime(x) {
  var d = new Date();
  var dh = padZero(d.getHours(), 2);
  var dm = padZero(d.getMinutes(), 2);
  var ds = padZero(d.getSeconds(), 2);
  var dmt = padZero((d.getMonth() + 1), 2);
  var dd = padZero(d.getDate(), 2);
  if (x !== 1) {
    return colors_console.gray + dmt + '/' + dd + ' ' + dh + ':' + dm + ':' + ds + ': ' + colors_console.reset;
  } else {
    return dmt + '/' + dd + ' ' + dh + ':' + dm + ':' + ds;
  }
}

function gt(x) {
  return getTime(x)
}

function cLog(v, c, c2) {
  var str = v;
  if (c === 'gray') {
    str = colors_console.gray + str + colors_console.reset
  }
  if (c === 'warn') {
    str = colors_console.yellow + 'WARN: ' + colors_console.reset + str
  }
  if (v.length > 1) {
    str = gt() + v
  }
  console.log(str);
  /*if(typeof io !== 'undefined'){
      io.emit('s-nlog', str+' <br>');}
      if(c==='object'){
          io.emit('s-object', c2);}*/
  log.full[log.full.length] = replaceAll(str, '\u001b', '') + ' <br>';
  log.partial[log.partial.length] = replaceAll(str, '\u001b', '') + ' <br>';
  log.partial_ext[log.partial_ext.length] = replaceAll(str, '\u001b', '') + ' <br>';

  if (log.partial.length > 200) { //Limits partial log to 200 entries
    log.partial = log.partial.slice(log.partial.length - 200, log.partial.length);
  }
  if (log.partial_ext.length > 750) { //Limits partial extended log to 750 entries
    log.partial_ext = log.partial_ext.slice(log.partial_ext.length - 750, log.partial_ext.length);
  }
}

cLog(gray("Loading Modules..."));

var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var previous_messages = [];

if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require('node-localstorage').LocalStorage;
  localStorage = new LocalStorage('./scratch');
} else {
  cLog('LocalStorage error', warn);
}

cLog(gray("Now starting Chatterbox v" + version + "..."));

var local_ip;
require('dns').lookup(require('os').hostname(), function (err, add, fam) {
  local_ip = add;
  cLog('Now listening on ' + add + ':8091', gray)
});

function createString(x) {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < (x != undefined ? x : 16); i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
var server_secureKey = createString(32);
var server_sessionKey = createString(4);


function cyan(input) {
  return colors_console.cyan + input + colors_console.reset;
}

function red(input) {
  return colors_console.red + input + colors_console.reset;
}

function gray(input) {
  return colors_console.gray + input + colors_console.reset;
}

var colors = {
  basic: [
    'MidnightBlue',
    'ForestGreen',
    'SaddleBrown',
    'Crimson'
  ],
  plus: [
    'DarkSlateGray',
    'MidnightBlue',
    'RoyalBlue',
    'DodgerBlue',
    'MediumSeaGreen',
    'ForestGreen',
    'DarkOliveGreen',
    'Olive',
    'Goldenrod',
    'DarkOrange',
    'OrangeRed',
    'Tomato',
    'DeepPink',
    'Crimson',
    'Chocolate',
    'Sienna',
    'SaddleBrown',
    'Maroon'
  ]
}
var colors_lc = {
  basic: [],
  plus: []
}
var colors_list = {
  basic: [],
  plus: []
}

function loadColorsIntoList() {
  var c = colors.basic;
  var r = '';
  for (var i = 0; i < c.length; i++) {
    colors_lc.basic[i] = c[i].toLowerCase();
    r += '<span style="color: ' + c[i] + '">';
    r += c[i];
    r += '</span>'
    if (i < c.length - 1) {
      r += ', '
    }
  }
  var c2 = colors.plus;
  var r2 = '';
  for (var j = 0; j < c2.length; j++) {
    colors_lc.plus[j] = c2[j].toLowerCase();
    r2 += '<span style="color: ' + c2[j] + '">';
    r2 += c2[j];
    r2 += '</span>';
    if (j < c2.length - 1) {
      r2 += ', '
    }
  }
  colors_list.basic = r;
  colors_list.plus = r2;
}
loadColorsIntoList();
/*
var accounts = {
  'ryanz': {
    chatname: 'Ryan',
    full_name: 'Ryan Zhang',
    color: 'midnightblue',
    password: md5(''),
    icon: true,
    text_styling: true,
    rank: 3
  },
  'riley': {
    chatname: 'Riley',
    full_name: 'Riley Wang',
    color: 'midnightblue',
    password: md5(''),
    icon: true,
    text_styling: true,
    rank: 0
  },
  'eniac': {
    chatname: 'Eniac',
    full_name: 'Eniac Zhang',
    color: 'midnightblue',
    password: md5(''),
    icon: false,
    text_styling: true,
    rank: 1
  },
  'mod': {
    chatname: '[Debug/Testing Account] Bob',
    full_name: 'Generic Moderator',
    color: 'midnightblue',
    password: md5(''),
    icon: true,
    text_styling: true,
    rank: 2
  },
  'guest': {
    chatname: 'Guest',
    full_name: 'Guest User',
    color: 'forestgreen',
    password: md5(''),
    icon: false,
    text_styling: true,
    rank: 0
  }
}*/
var accounts = {
}

var banlist = {};

if (force_reset_profiles === false) {
  if (localStorage.getItem('cb_accounts') !== null) {
    accounts = jsonfile.readFileSync(path.join(__dirname, 'accountdb.json'));
    banlist = localStorage.cb_banlist === undefined ? {} : JSON.parse(localStorage.getItem('cb_banlist'));
    cLog(gray('Successfully loaded data'));
  }
}

var lastLoginRequest = {

}

var online_users = {

};

var pendingVerification = {

};

var msc = { //Message spam count (in last 10 min)

}

var vtc = { //Verification trigger count (in last 5 min)

}

var lmtc = { //Long message trigger count (WPM > 160)

}

var vtcl = {

}

var loginKeys = {
  
}

var users_antiSpam = {
  'lastMessage': {

  },
  'lastFiveMessages': {

  },
  'lastTwentySenders': []
}

var cookie_ip = {

}

var ou_lp = {

}
//Online users - Last ping

//var cookie_socket = {}

/*
Ranks
0: Default
1: Plus
2: Mod
3: Admin
*/

function getUrlVars(str){
  var vars = [], hash;
  var hashes = str.slice(str.indexOf('?') + 1).split('&');
  for(var i = 0; i < hashes.length; i++){
    hash = hashes[i].split('=');
    if(vars.indexOf(hash[0])>-1){
      vars[hash[0]]+=","+hash[1];
    }
    else{
      vars.push(hash[0]);
      vars[hash[0]] = hash[1];
    }
  }
  return vars;
}

app.get('/', function (req, res) {
  var urlVars = getUrlVars(req.url);
  if(urlVars['authKey'] !== undefined){
    if(loginKeys[urlVars['authKey']]){
      res.cookie('sid', urlVars['authKey'], {expiration: 604800000, httpOnly: true})
      res.redirect(303, req.url.slice(0, req.url.indexOf('?')));
    }
    else{
      res.redirect(301, 'https://ryan778.herokuapp.com/personal/signin/?internal=no&continue=http://special:serviceurl:chatterbox:8091/&service=ChatterBox');
    }
  }
  else{
    res.sendFile(__dirname + '/index.html');
  }
});

app.get('/sso', function(req, res){
  var urlVars = getUrlVars(req.url);
  if(urlVars['authKey'] !== undefined){
    request.post({
      url:'https://ryan778.herokuapp.com/personal/validateKey', 
      json: true, 
      headers: {'content-type': 'application/json'}, 
      body: {"key": getUrlVars(req.url)['authKey']}
    }, function(err, httpResponse, response){
      if(response.valid === false){
        res.redirect(303, 'https://ryan778.herokuapp.com/personal/signin/?internal=no&continue=http://special:serviceurl:chatterbox:8091/&service=ChatterBox');
      }
      else{
        loginKeys[getUrlVars(req.url)['authKey']] = {user: response.username, expiration: response.expiration}
        res.cookie('sid', getUrlVars(req.url)['authKey'], {httpOnly: true, maxAge: (response.expiration-Date.now())});
        res.redirect(303, '..');
      }
    })
  }
  else{
    res.redirect(303, 'https://ryan778.herokuapp.com/personal/signin/?internal=no&continue=http://special:serviceurl:chatterbox:8091/&service=ChatterBox');
  }
})

app.get('/sso/auth', function(req, res){
  var urlVars = getUrlVars(req.url);
  if(urlVars['usrn'] !== undefined && urlVars['pswd'] !== undefined){
    if(accounts[urlVars['usrn']] !== undefined){
      bcrypt.compare(urlVars['pswd'], accounts[urlVars['usrn']]['password'], function(err, pres){
        if(pres){
          var key = createString(32);
          loginKeys[key] = {user: urlVars['usrn'], expiration: Date.now()+604800000}
          res.json({'res': 'success', 'key': key});
        }
        else{
          res.json({'res': 'error', 'reason': 'invpswd'});
        }
      })
    }
    else{
      res.json({'res': 'error', 'reason': 'invuser'});
    }
  }
  else{
    res.json({'res': 'error', 'reason': 'invuser'});
  }
})

app.get('/style_main.css', function (req, res) {
  res.sendFile(__dirname + '/style_main.css');
});
app.get('/style_chat.css', function (req, res) {
  res.sendFile(__dirname + '/style_chat.css');
});
if (devBuild) {
  app.get('/script-client.js', function (req, res) {
    res.sendFile(__dirname + '/script-client.js');
  });
} else {
  app.get('/script-client.js', function (req, res) {
    res.sendFile(__dirname + '/script-client-min.js');
  });
}

app.get('/themes/default.css', function (req, res) {
  res.sendFile(__dirname + '/themes/default.css');
});
app.get('/themes/blue.css', function (req, res) {
  res.sendFile(__dirname + '/themes/blue.css');
});
app.get('/themes/flat.css', function (req, res) {
  res.sendFile(__dirname + '/themes/flat.css');
});
app.get('/themes/rainbow.css', function (req, res) {
  res.sendFile(__dirname + '/themes/rainbow.css');
});
app.get('/style_checkboxes.css', function (req, res) {
  res.sendFile(__dirname + '/style_checkboxes.css');
});

function saveData() {
  jsonfile.writeFile(path.join(__dirname, 'accountdb.json'), accounts);
  localStorage.setItem('cb_banlist', JSON.stringify(banlist));
  cLog('Data Saved.');
}

if (force_reset_profiles) {
  cLog('Resetting Profiles...');
  saveData();
  cLog('Complete.');
}

var rhtml_b = 0;

function rhtml_fb(match) {
  if (rhtml_b === 0) {
    rhtml_b = 1;
    return '<b>'
  } else if (rhtml_b === 1) {
    rhtml_b = 0;
    return '</b>';
  }
}
var rhtml_i = 0;

function rhtml_fi(match) {
  if (rhtml_i === 0) {
    rhtml_i = 1;
    return '<i>'
  } else if (rhtml_i === 1) {
    rhtml_i = 0;
    return '</i>';
  }
}

function rhtml(mystring, formatting) {
  var newstring = mystring.toString().replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  if (formatting) {
    newstring = newstring.replace(/\*/g, rhtml_fb);
    if (rhtml_b === 1) {
      rhtml_b = 0;
      newstring = newstring.slice(0, newstring.lastIndexOf('<b>')) + '*' + newstring.slice(newstring.lastIndexOf('<b>') + 3, newstring.length)
    }

    newstring = newstring.replace(/_/g, rhtml_fi);
    if (rhtml_i === 1) {
      rhtml_i = 0;
      newstring = newstring.slice(0, newstring.lastIndexOf('<i>')) + '_' + newstring.slice(newstring.lastIndexOf('<i>') + 3, newstring.length)
    }
  }
  return newstring;
}

function generateCookie() {
  return 'cio=' + createString(16);
}

function ban(target, reason) {
  if (reason === undefined || reason === '') {
    reason = 'No Reason Provided'
  }
  sendServerMessage('<span style="color: #55f">' + target + '</span> was automatically banned.')
  msg_admins('Automatically Banned <span style="color: #55f">' + target + '</span>: <span style="color: #559dff">' + reason + '</span>')
  while (online_users[target] !== undefined) {
    removeToken(online_users[target][0], 'f');
  }
  io.emit('u-ban', [target, rhtml('[Automated Ban] ' + reason, true)]);
  banlist[target] = (rhtml('[Automated Ban] ' + reason, true));
  cLog('Automatically banned user ' + cyan(target) + ': ' + red(reason));
  var username = getFullUserInfo(target)['name'];
  if (username === undefined) {
    username = target
  }
  saveData();
}

function kick(target, reason) {
  target = target.toLowerCase();
  if (online_users[target] !== undefined) {
    sendServerMessage('<span style="color: #55f">' + target + '</span> was automatically kicked.')
    msg_admins('Automatically kicked <span style="color: #55f">' + target + ' </span>; Reason: ' + reason + '.');
    sendServerMessage()
    if (reason === undefined || reason === '') {
      reason = '[Automated Kick] You were kicked from the server.'
    } else {
      reason = '[Automated Kick] ' + reason;
    }
    while (online_users[target] !== undefined) {
      removeToken(online_users[target][0], 'f');
    }
    io.emit('u-kick', [target, rhtml(reason, true)]);
    cLog('Automatically kicked user ' + cyan(target) + ': ' + red(reason));
  }
}

function forceVerification(msg, socket, cookie, user) {
  if (vtc[user] === undefined) {
    vtc[user] = 0
  }
  if (vtcl[user] === undefined) {
    vtcl[user] = 0
  }
  vtc[user]++;
  vtcl[user]++;
  setTimeout(function () {
    vtc[user]--;
  }, 300000); //Remove the trigger after 5 minutes
  setTimeout(function () {
    vtcl[user]--;
  }, 900000); //
  if (vtc[user] >= 60 || vtcl[user] >= 100) { //Should NEVER happen for legitimate users
    var userInfo = getFullUserInfo(user);
    var target = userInfo.username;
    cLog('User ' + cyan(user) + ' automatically (or rarely, manually) triggered verification: ' + (vtc[user] >= 60 ? 'Over 60 triggers in 300 seconds' : 'Over 100 triggers in 900 seconds') + '.');
    ban(target, 'Automatically triggered the verification button or spammed too much');
  }
  pendingVerification[cookie] = [createString(12), msg, 0];
  if (vtc[user] <= 10) { //Likely user error
    sendServerMessage('Due to suspicious behavior from your account, click verify to continue chatting and avoid getting' + (vtc[user] > 3 ? '<span style="color: #55f; display: none" id=' + createString(6) + ' onclick="socket.emit(\'u-verify\', [[client_username, client_token], \'DECOY_' + createString(6) + '\']); this.style.color=\'#aaa\'; this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>' : '') + ' disconnected. <span style="color: #55f; cursor: pointer" id=' + createString(4) + ' onclick="socket.emit(\'u-verify\',[[client_username,client_token], \'' + pendingVerification[cookie][0] + '\']);this.style.color=\'#aaa\';this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>', socket);
  } else { //Likely intentional spamming, generate a hard-to-automatically-verify button
    var msg = 'Due to suspicious behavior from your account, click verify to continue chatting and avoid getting disconnected. '.split(' ');
    var css = '<style>';
    for (var i = 0; i < msg.length; i++) {
      if (Math.random() < 0.4) {
        if (Math.random() < 0.5) {
          msg[i] += '<span style="color: #55f; display: none" id=' + createString(6) + ' onclick="socket.emit(\'u-verify\',[[client_username,client_token], \'' + createString(12) + '\']);this.style.color=\'#aaa\';this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>';
        } else {
          var key = createString(6);
          msg[i] += '<span style="color: #55f; cursor: pointer" id=' + key + ' onclick="socket.emit(\'u-verify\',[[client_username,client_token], \'' + createString(12) + '\']);this.style.color=\'#aaa\';this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>';
          if (css !== '<style>') {
            css += ','
          }
          css += ("[id='" + key + "']");
        }
      }
    }
    css += '{display:none}</style>';
    var slot = Math.round(Math.random() * (msg.length - 1));
    msg[slot] += css;
    msg = msg.join(' ');
    msg += '<span style="color: #55f; cursor: pointer" id=' + createString(6) + ' onclick="socket.emit(\'u-verify\',[[client_username,client_token], \'' + pendingVerification[cookie][0] + '\']);this.style.color=\'#aaa\';this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>';
    for (var i = 0; i < Math.round(Math.random() * 4 + 1); i++) {
      msg += '<span style="color: #55f; display: none" id=' + createString(6) + ' onclick="socket.emit(\'u-verify\',[[client_username,client_token], \'' + createString(12) + '\']);this.style.color=\'#aaa\';this.onclick=\'\'; this.style.cursor=\'default\';">[Verify]</span>';
    }
    sendServerMessage(msg, socket);
  }
  cLog('User ' + cyan(user) + ' activated Force Verification Failsafe');
}

function addUserToken(user, cookie, ip, socket) {
  if (typeof ip === 'string') {
    cookie_ip[cookie] = ip
  }
  //cookie_socket[cookie] = socket;
  if (Object.keys(online_users).indexOf(user) === -1) {
    online_users[user] = [cookie];
    cLog('Successfully added token ' + cookie + ' for ' + user + '');
    sendServerMessage(accounts[user]['chatname'] + ' joined the chat');
    previous_messages[previous_messages.length] = '<span style="color: gray"><span class="chat_name">Server</span>: ' + accounts[user]['chatname'] + ' joined the chat' + '</span>';
    users_antiSpam['lastMessage'][user] = Date.now();
  } else {
    online_users[user][online_users[user].length] = cookie;
    cLog('Successfully added token ' + cookie + ' for ' + user + '');
  }
}

function removeToken(token, l) {
  if (l == 'l') {
    l = 'Logout'
  } else if (l === 'd') {
    l = 'Disconnect'
  } else if (l === 'f') {
    l = 'Forced Disconnection'
  } else {
    l = 'Unreachable'
  }
  var users = Object.keys(online_users);
  var rm = false;
  for (var i = 0; i < users.length; i++) {
    var o = online_users[users[i]];
    if (o.indexOf(token) !== -1) {
      rm = true;
      online_users[users[i]].splice(o.indexOf(token), 1);
      if (Object.keys(cookie_ip).indexOf(token) !== -1) {
        delete cookie_ip[token]
      }
      //if(Object.keys(cookie_socket).indexOf(token)!==-1){delete cookie_socket[token]}
      cLog('Successfully removed token ' + cyan(token) + ' from ' + cyan(users[i]) + ' (' + l + ')');
    }
  }

  for (i in online_users) {
    if (online_users[i].length === 0) {
      cLog('Removed user ' + i + ' from online users');
      sendServerMessage(accounts[i]['chatname'] + ' left the chat');
      previous_messages[previous_messages.length] = '<span style="color: gray"><span class="chat_name">Server</span>: ' + accounts[i]['chatname'] + ' left the chat' + '</span>';
      delete online_users[i];
    }
  }

  if (rm === false) {
    cLog('Could not find token ' + token + ' in online users (' + l + ')', 'warn');
  }
}

var confirmedTokens = [];

function removeInvalidTokens() {
  var allTokens = [];
  var tokens_o = [];
  for (var i in online_users) {
    allTokens = allTokens.concat(online_users[i]);
    tokens_o = tokens_o.concat(online_users[i]);
  }

  for (var i = 0; i < allTokens.length; i++) {
    if (confirmedTokens.indexOf(allTokens[i]) === -1) { //Invalid Token - For now, only remove if its a custom token until an AFK system is made.
      if (allTokens[i].slice(0, 1) === 'c') {
        removeToken(allTokens[i], 'u');
      } else {
        cLog('Token ' + allTokens[i] + ' is not present; Not removing token (AFK not implemented yet)');
      }
    }
  }

  confirmedTokens = [];
}

function validateTokens() {
  io.emit('u-validateToken');
  setTimeout(removeInvalidTokens, 1000);
}

//setInterval(validateTokens, 5 * 1000); //Disabled, may be reimplemented in the future

function getNameFromRank(v) {
  switch (v) {
  case 0:
  default:
    return 'Basic'
    break;
  case 1:
    return 'Plus'
    break;
  case 2:
    return 'Mod'
    break;
  case 3:
    return 'Admin'
    break;
  }
}

function getIcon(v) {
  switch (v) {
  case 1:
    return '<span class="fa-stack chat-icon"><i style="color: navy" class="fa fa-square-o fa-stack-2x"></i><i title="Plus User" style="color: navy" class="fa fa-plus fa-stack-1x"></i></span>';
    break;
  case 2:
    return '<span class="fa-stack chat-icon"><i style="color: #abf" class="fa fa-square fa-stack-2x"></i><i title="Moderator" style="color: #0a0" class="fa fa-leaf fa-stack-1x"></i></span>'
    break;
  case 3:
    return '<span class="fa-stack chat-icon"><i style="color: #abf" class="fa fa-square fa-stack-2x"></i><i title="Admin" style="color: #fe3" class="fa fa-bolt fa-stack-1x"></i></span>'
    break;
  case 0:
  default:
    return '';
  }
}

function getUserInfo(input) {
  var username = input[0];
  var token = input[1];
  if (online_users[username] !== undefined) {
    if (online_users[username].indexOf(token) !== -1) {
      var iconOn = accounts[username]['icon'];
      var userRank = accounts[username]['rank'];
      var userColor = accounts[username]['color'];
      var userName = accounts[username]['chatname'];
      return {
        username: username,
        name: userName,
        color: userColor,
        icon: iconOn,
        formatting: accounts[username]['text_styling'],
        rank: userRank,
        prefix: (iconOn ? getIcon(userRank) : '') + '<span class="chat_name" style="color: ' + userColor + '">' + userName + ':</span> '
      };
    } else {
      cLog(token);
      return false;
    }
  } else {
    return false;
  }
}

function getFullUserInfo(input) {
  var username = input;
  if (accounts[username] !== undefined) {
    var iconOn = accounts[username]['icon'];
    var userRank = accounts[username]['rank'];
    var userColor = accounts[username]['color'];
    var userName = accounts[username]['chatname'];
    return {
      username: username,
      name: userName,
      color: userColor,
      icon: iconOn,
      formatting: accounts[username]['text_styling'],
      rank: userRank,
      rankname: getNameFromRank(userRank),
      prefix: (iconOn ? getIcon(userRank) : '') + '<span class="chat_name" style="color: ' + userColor + '">' + userName + ':</span> ',
      chatname: (iconOn ? getIcon(userRank) : '') + '<span style="color: ' + userColor + '">' + userName + '</span> '

    };
  } else {
    return false;
  }
}

function msg_admins(value) {
  io.to('admins').emit('u-msg', '<span style="color: gray" class="chat_name">Server</span>: ' + value);
}

function sendServerMessage(msg, sk, g) {
  if (sk === null || sk === undefined) {
    io.emit('u-msg', '<span style="color: gray"><span class="chat_name">Server</span>: ' + msg + '</span>');
  } else {
    sk.emit('u-msg', '<span style="color: gray">' + (!g ? '<span class="chat_name">Server</span>: ' : '') + msg + '</span>');
  }
}

function parseCookies (request) {
  var list = {},
  rc = request;
  rc && rc.split(';').forEach(function( cookie ) {
    var parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });

  return list;
}

io.on('connection', function (socket) {
  var IP = getIP(socket.request.connection.remoteAddress);
  var cookie = socket.handshake.headers.cookie;
  if (cookie === undefined) {
    cookie = false;
    socket.emit('err-invalidToken')
  }

  socket.on('s-confirmToken', function (token) {
    if (token === 'h') {
      token = cookie
    }
    //confirmedTokens[confirmedTokens.length] = token;
  });
  socket.on('s-ping', function (ck) {
    if (token === 'h') {
      token = ck
    }
    var u = getUserInfo()
  })
  socket.on('s-sidlogin', function(){
    var sid = parseCookies(cookie);
    if(sid === undefined){
      socket.emit('s-sidlogin', 'fail');
    }
    else{
      if(sid.sid === undefined){
        socket.emit('s-sidlogin', 'fail');
      }
      else{
        if(loginKeys[sid.sid] === undefined){
          socket.emit('s-sidlogin', 'fail');
        }
        else{
          if(Date.now() > loginKeys[sid.sid]['expiration']){
            socket.emit('s-sidlogin', 'fail');
          }
          else{
            socket.emit('s-sidlogin', 'success');
            var usr = loginKeys[sid.sid]['user'];
            if (Object.keys(banlist).indexOf(usr.toLowerCase()) === -1) {
              var acct = accounts[usr];
              confirmedTokens[confirmedTokens.length] = cookie;
              cLog('Logged in user ' + cyan(usr) + ' from IP ' + IP + ' (via sid)');
              addUserToken(usr, cookie, IP, socket);
              ou_lp[usr] = Date.now();
              if (!cookie) {
                socket.emit('u-cookie', cookie)
              } else {
                socket.emit('u-cookie', 'h')
              }
              socket.emit('u-login', [true, usr, acct['full_name'], acct['rank'], getIcon(acct['rank'])]);
              if (acct['rank'] === 3) {
                socket.join('admins')
              }
            } else {
              cLog('User ' + cyan(usr) + ' attempted to login from ' + IP + ' (Banned) (via sid)');
              socket.emit('u-login', ['banned', banlist[usr]]);
            }
          }
        }
      }
    }
  })
  socket.on('s-login', function (v) {
    //v: [username,password]
    if (lastLoginRequest[cookie] === undefined) {
      lastLoginRequest[cookie] = (Date.now() - 1000)
    }
    if (!cookie) {
      socket.emit('err-nc')
    } else if (Date.now() - lastLoginRequest[cookie] > 250) {
      lastLoginRequest[cookie] = Date.now();
      try {
        var usr = v[0][0];
        var pswd = v[1];
      }
      catch(err){socket.emit('u-login', ['false', 'usrn']); return;}
      if (accounts[usr] !== undefined) {
        bcrypt.compare(pswd, accounts[usr]['password'], function(err, res){
          if(res){
            if (Object.keys(banlist).indexOf(usr.toLowerCase()) === -1) {
              var acct = accounts[usr];
              confirmedTokens[confirmedTokens.length] = cookie;
              cLog('Logged in user ' + cyan(usr) + ' from IP ' + IP);
              addUserToken(usr, cookie, IP, socket);
              ou_lp[usr] = Date.now();
              if (!cookie) {
                socket.emit('u-cookie', cookie)
              } else {
                socket.emit('u-cookie', 'h')
              }
              socket.emit('u-login', [true, usr, acct['full_name'], acct['rank'], getIcon(acct['rank'])]);
              if (acct['rank'] === 3) {
                socket.join('admins')
              }
            } else {
              cLog('User ' + cyan(usr) + ' attempted to login from ' + IP + ' (Banned)');
              socket.emit('u-login', ['banned', banlist[usr]]);
            }
          } else {
            cLog('User ' + cyan(usr) + ' attempted to login from ' + IP);
            socket.emit('u-login', [false, 'pswd']);
          }
        });
      } else {
        socket.emit('u-login', [false, 'usrn']);
      }
    } else {
      socket.emit('err-rl');
    }
  });
  socket.on('s-sendMsg', function (v) {
    if (v[0][1] === 'h') {
      v[0][1] = cookie
    }
    var userInfo = getUserInfo(v[0]);
    if (Object.keys(banlist).indexOf(userInfo.username) !== -1) {
      sendServerMessage('You are banned and cannot send messages.', socket)
    } else if (!userInfo) { //Invalid token (ex. if client side was tampered and /kick didn't disconnect them)
      sendServerMessage('Invaild Session Token. Logout and login again.', socket);
    } else if (userInfo && msg !== '') {
      var msg = v[1];
      if (msg.slice(0, 1) === '/') { //Parse Command
        cLog('User ' + cyan(userInfo.username) + ' ran command ' + cyan(msg));
        var cmd = msg.slice(1, msg.length).split(' ');
        switch (cmd[0].toLowerCase()) {
        case 'color':
          if (cmd[1] === 'options' || cmd[1] === 'help' || cmd[1] === undefined) {
            if (userInfo.rank >= 1) {
              sendServerMessage('Avaliable Colors: Either a hex code (ex. <span style="color: #4169e1">#4169e1</span>/<span style="color: #46e"?>#46e</span>) or one of the preset colors (' + colors_list['plus'] + ')', socket);
            } else {
              sendServerMessage('Avaliable Colors: ' + colors_list['basic'], socket);
            }
          } else if (colors_lc.basic.indexOf(cmd[1].toLowerCase()) !== -1) {
            var cp = colors_lc.basic.indexOf(cmd[1].toLowerCase());
            accounts[userInfo.username]['color'] = colors.basic[cp];
            sendServerMessage('Your color has been changed to <span style="color: ' + cmd[1] + '">' + colors.basic[cp] + '</span>.', socket)
            saveData();
          } else if (colors_lc.plus.indexOf(cmd[1].toLowerCase()) !== -1) {
            var cp = colors_lc.plus.indexOf(cmd[1].toLowerCase());
            if (userInfo.rank >= 1) {
              accounts[userInfo.username]['color'] = colors.plus[cp];
              sendServerMessage('Your color has been changed to <span style="color: ' + cmd[1] + '">' + colors.plus[cp] + '</span>.', socket)
              saveData();
            } else {
              sendServerMessage('The color <span style="color: ' + colors.plus[cp] + '">' + colors.plus[cp] + '</span> requires the rank Plus or higher.', socket);
            }
          } else if (cmd[1].slice(0, 1) === '#' && cmd[1].length === 4 || cmd[1].slice(0, 1) === '#' && cmd[1].length === 7) {
            var color = hexToRgb(cmd[1]);
            if (color === null) {
              sendServerMessage('Invalid Hex Color.', socket);
            } else if (color.r >= 238 && color.g >= 238 && color.b >= 238) {
              sendServerMessage('The color white or colors close to white (ex. #eee) are not allowed.', socket);
            } else {
              if (userInfo.rank >= 1) {
                cmd[1] = cmd[1].toLowerCase();
                accounts[userInfo.username]['color'] = cmd[1];
                sendServerMessage('Your color has been changed to <span style="color: ' + cmd[1] + '">' + cmd[1] + '</span>', socket);
                saveData();
              } else {
                sendServerMessage('Hex colors require the rank Plus or higher.', socket);
              }
            }
          } else {
            sendServerMessage('Invalid Color. To see color options, use /color help or /color options', socket)
          }
          break;
        case 'help':
          sendServerMessage('Avaliable Commands: ', socket)
          sendServerMessage('/help: Shows this help message', socket, true)
          sendServerMessage('/color [color|options|help]: Changes the color of your name', socket, true);
          sendServerMessage('/list: See who is online', socket, true);
          sendServerMessage(rhtml('/getusername <chatname>: Returns the username of a user (Alias: /usrn)'), socket, true);
          sendServerMessage(rhtml('/userinfo <username>: Returns a user\'s profile info'), socket, true);
          if (userInfo.rank >= 1) {
            sendServerMessage(rhtml('/icon <on|true|off|false|toggle>: Turns your icon on/off. Only shows an icon if your rank is Plus or higher.'), socket, true);
          }
          if (userInfo.rank >= 2) {
            sendServerMessage(rhtml('/kick <username> [reason]: Kicks an online user'), socket, true);
          }
          if (userInfo.rank >= 3) {
            sendServerMessage(rhtml('/getip <username>: Shows the session token and IP of the user.'), socket, true);
            sendServerMessage(rhtml('/setrank <username> <basic|plus|mod|0|1|2>: Changes the rank of a user.'), socket, true);
            sendServerMessage(rhtml('/ban <user> [reason]: Bans a user from joining the server'), socket, true);
            sendServerMessage(rhtml('/unban <user>: Unbans a user previously banned'), socket, true);
            sendServerMessage('/banlist: Shows a list of banned users', socket, true);
            sendServerMessage(rhtml('/verification <on|true|off|false|status>: See or change the strict verification setting', true), socket, true);
          }
          break;
        case 'list':
          var online = [];
          for (var i in online_users) {
            if (userInfo.rank < 3) {
              online[online.length] = '<span style="color: ' + accounts[i]['color'] + '">' + accounts[i]['chatname'] + '</span>';
            } else {
              online[online.length] = '<span style="color: ' + accounts[i]['color'] + '">' + accounts[i]['chatname'] + ' (x' + online_users[i].length + ')</span>';
            }
          }
          online = online.join(', ');
          sendServerMessage('Online Users: ' + online, socket);
          break;
        case 'getusername':
        case 'usrn':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /getusername <chatname> (Not case sensitive; Alias: /usrn)'), socket);
          } else {
            var usr;
            var searchTerm = cmd.slice(1, cmd.length).join(' ');
            for (i in accounts) {
              if (accounts[i]['chatname'].toLowerCase() === searchTerm.toLowerCase()) {
                usr = i;
              }
            }
            if (online_users[usr] !== undefined || userInfo.rank >= 2) {
              sendServerMessage('Username of ' + searchTerm + ': <span style="color: #55f">' + usr + '</span>', socket);
            } else {
              sendServerMessage('Getting the username of offline users requires the rank <span style="color: #55f">MOD</span>.');
            }
          }
          break;
        case 'getip':
          if (userInfo.rank >= 3) {
            if (cmd[1] === undefined) {
              sendServerMessage(rhtml('Usage: /getip <username>'), socket);
            } else if (online_users[cmd[1]] !== undefined) {
              var cookies = online_users[cmd[1]];
              if (cookies.length === 1) {
                sendServerMessage('User <span style="color: #55f">' + cmd[1] + '</span> is logged in at ' + cookie_ip[cookies[0]] + ' (Session Token: ' + cookies[0] + ')', socket);
              } else {
                sendServerMessage('User <span style="color: #55f">' + cmd[1] + '</span> is logged in from multiple locations: ', socket);
                for (var i = 0; i < cookies.length; i++) {
                  sendServerMessage('IP <span style="color: #55f">' + cookie_ip[cookies[i]] + '</span> (Session Token: <span style="color: #55f">' + cookies[i] + '</span>)', socket, true);
                }
              }
              cLog(cookie_ip);
            } else {
              sendServerMessage('User <span style="color: #55f">' + cmd[1] + '</span> is not online or does not exist.')
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">ADMIN</span>');
          }
          break;
        case 'getuserinfo':
        case 'userinfo':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /' + cmd[0] + ' <username>'), socket);
          } else if (online_users[cmd[1]] !== undefined) {
            var cookies = online_users[cmd[1]];
            var ckIP = [];
            if (cookies.length === 1) {
              ckIP = [cookie_ip[cookies[0]]]
            } else {
              for (var i = 0; i < cookies.length; i++) {
                ckIP[ckIP.length] = cookie_ip[cookies[i]];
              }
            }
            ckIP = ckIP.join('</span>, <span style="color: #55f">');

            var targetUser = getFullUserInfo(cmd[1]);
            sendServerMessage('User Info for <span style="color: #55f">' + cmd[1] + '</span>:', socket);
            sendServerMessage('Status: <span style="color: #383">Online</span>' + (userInfo.rank >= 3 ? ' (<span style="color: #55f">' + ckIP + '</span>)' : ''), socket, true);
            sendServerMessage('Rank: <span style="color: #55f">' + getIcon(targetUser.rank) + ' ' + targetUser.rankname + '</span>', socket, true);
            sendServerMessage('Chat Name: ' + (targetUser.icon ? getIcon(targetUser.rank) : '') + '<span class="chat_name" style="color: ' + targetUser.color + '">' + targetUser.name + '</span>', socket, true);
            if (userInfo.rank >= 3) {
              if (msc[targetUser.username] === undefined) {
                msc[targetUser.username] = 0
              }
              sendServerMessage('Spam messages in the last 10 minutes: <span style="color: #55f">' + msc[targetUser.username] + '</span>', socket, true);
              if (vtc[targetUser.username] === undefined) {
                vtc[targetUser.username] = 0
              }
              sendServerMessage('Verification requests in the last 5 minutes: <span style="color: #55f">' + vtc[targetUser.username] + '</span>', socket, true);
              if (lmtc[targetUser.username] === undefined) {
                lmtc[targetUser.username] = 0
              }
              sendServerMessage('Copy/Pasted/Long Automated messages in the last 5 minutes: <span style="color: #55f">' + lmtc[targetUser.username] + '</span>', socket, true);
            }
          } else {
            if (userInfo.rank >= 2) {
              if (accounts[cmd[1]] !== undefined) {
                var targetUser = getFullUserInfo(cmd[1]);
                sendServerMessage('User Info for <span style="color: #55f">' + cmd[1] + '</span>:', socket);
                sendServerMessage('Status: <span style="color: #f55">Offline</span>', socket, true);
                sendServerMessage('Rank: <span style="color: #55f">' + getIcon(targetUser.rank) + ' ' + getNameFromRank(targetUser.rank) + '</span>', socket, true);
                sendServerMessage('Chat Name: ' + (targetUser.icon ? getIcon(targetUser.rank) : '') + '<span class="chat_name" style="color: ' + targetUser.color + '">' + targetUser.name + '</span>', socket, true);

              } else {
                sendServerMessage('User <span style="color: #55f">' + cmd[1] + '</span> does not exist.')
              }
            } else {
              sendServerMessage('User <span style="color: #55f">' + cmd[1] + '</span> is not online; You can only get the user info for online users.')
            }
          }
          break;
        case 'kick':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /kick <username> [reason]'), socket);
          } else if (userInfo.rank >= 2) {
            var target = cmd[1].toLowerCase();
            if (online_users[target] !== undefined) {
              if (accounts[target]['rank'] <= 1 || userInfo.rank >= 3 && accounts[target]['rank'] <= userInfo.rank) {
                sendServerMessage('Successfully kick <span style="color: #55f">' + accounts[target]['chatname'] + ' (' + target + ')</span>.', socket);
                var reason = cmd.slice(2, cmd.length).join(' ');
                while (online_users[target] !== undefined) {
                  removeToken(online_users[target][0], 'f');
                }
                io.emit('u-kick', [target, rhtml(reason, true)]);
              } else {
                sendServerMessage('You cannot kick that user!', socket);
              }
            } else if (accounts[target] !== undefined) {
              sendServerMessage('The user <span style="color: #55f">' + cmd[1] + '</span> is not online.', socket);
            } else {
              sendServerMessage('The user <span style="color: #55f">' + cmd[1] + '</span> does not exist.', socket);
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">MOD</span>.', socket);
          }
          break;
        case 'ban':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /ban <username> [reason]'), socket);
          } else if (userInfo.rank >= 3) {
            var target = cmd[1].toLowerCase();
            if (accounts[target] !== undefined) {
              if (accounts[target]['rank'] <= 2) {
                sendServerMessage('Successfully banned <span style="color: #55f">' + accounts[target]['chatname'] + ' (' + target + ')</span>.', socket);
                var reason = cmd.slice(2, cmd.length).join(' ');
                io.emit('u-ban', [target, rhtml((reason === '' ? 'No Reason Provided' : reason), true)]);
                banlist[target] = (reason === '' ? 'No Reason Provided' : rhtml(reason, true));
                saveData();
              } else {
                sendServerMessage('You cannot ban admins!', socket);
              }
            } else {
              sendServerMessage('The user <span style="color: #55f">' + cmd[1] + '</span> does not exist.', socket);
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">Admin</span>.', socket);
          }
          break;
        case 'unban':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /unban <username>'), socket);
          } else if (userInfo.rank >= 3) {
            var target = cmd[1].toLowerCase();
            if (accounts[target] !== undefined) {
              if (Object.keys(banlist).indexOf(target) !== -1) {
                sendServerMessage('Successfully unbanned <span style="color: #55f">' + accounts[target]['chatname'] + ' (' + target + ')</span>.', socket);
                delete banlist[target];
                saveData();
              } else {
                sendServerMessage('The user <span style="color: #55f">' + target + '</span> is not currently banned.', socket);
              }
            } else {
              sendServerMessage('The user <span style="color: #55f">' + cmd[1] + '</span> does not exist.', socket);
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">Admin</span>.', socket);
          }
          break;
        case 'banlist':
          if (userInfo.rank >= 3) {
            if (Object.keys(banlist).length === 0) {
              sendServerMessage('Nobody is currently banned.', socket);
            } else {
              sendServerMessage('Currently banned users: ', socket);
              for (var i = 0; i < Object.keys(banlist).length; i++) {
                sendServerMessage((i + 1) + ') <span style="color: #55f">' + Object.keys(banlist)[i] + '</span>: ' + banlist[Object.keys(banlist)[i]], socket, true);
              }
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">Admin</span>.', socket);
          }
          break;
        case 'setrank':
          if (cmd[1] === undefined) {
            sendServerMessage(rhtml('Usage: /setrank <username> <basic|plus|mod|0|1|2> [consolePIN]'), socket);
          } else if (userInfo.rank >= 3 || cmd[3] === '49153') {
            var target = cmd[1].toLowerCase();
            if (accounts[target] !== undefined) {
              if (cmd[2] !== undefined) {
                var newrank = -1;
                var newrankname = '';
                if (parseInt(cmd[2]) >= 1 && parseInt(cmd[2]) <= 3) {
                  newrank = parseInt(cmd[2]);
                  switch (newrank) {
                  case 0:
                    newrankname = 'Basic';
                    break;
                  case 1:
                    newrankname = 'Plus';
                    break;
                  case 2:
                    newrankname = 'Mod';
                    break;
                  case 3:
                    newrankname = 'Admin';
                    break;
                  default:
                    cLog('Unknown Rank ID: ' + newrank + '|' + cmd[2], 'warn');
                    break;
                  }
                } else {
                  switch (cmd[2].toLowerCase()) {
                  case 'basic':
                    newrank = 0;
                    newrankname = 'Basic';
                    break;
                  case 'plus':
                    newrank = 1;
                    newrankname = 'Plus';
                    break;
                  case 'mod':
                    newrank = 2;
                    newrankname = 'Mod';
                    break;
                  case 'admin':
                    newrank = 3;
                    newrankname = 'Admin';
                  default:
                    newrank = -1;
                    cLog('Unknown Rank ID: ' + cmd[2], 'warn');
                    break;
                  }
                }
                if (newrank !== -1) {
                  if (newrank === 4 && cmd[3] === '49153' || newrank < 4) {
                    if (accounts[target]['rank'] <= 3) {
                      accounts[target]['rank'] = newrank;
                      saveData();
                      sendServerMessage('Successfully changed the rank of <span style="color: #55f">' + accounts[target]['chatname'] + ' </span><span style="color:#3a3">(' + target + ')</span> to <span style="color: #55f">' + newrankname + '</span>.', socket);
                      io.emit('u-kick', [target, 'special:diffrank']);
                    } else {
                      sendServerMessage('You cannot change the rank of admins!', socket);
                    }
                  } else {
                    sendServerMessage('Changing a user\'s rank to <span style="color: #55f>Admin</span> requires the console PIN."', socket);
                  }
                } else {
                  sendServerMessage('Unknown Rank: <span style="color: #55f>"' + cmd[2] + '</span>', socket);
                }
              } else {
                sendServerMessage('Usage: /setrank <username> <basic|plus|mod|0|1|2>', socket);
              }
            } else {
              sendServerMessage('The user <span style="color: #55f">' + cmd[1] + '</span> does not exist.', socket);
            }
          } else {
            sendServerMessage('This command requires the rank <span style="color: #55f">Admin</span>.', socket);
          }
          break;
        case 'icon':
          if (userInfo.rank < 1) {
            sendServerMessage('Icons require the rank <span style="color: #55a">Plus</span> or higher.')
          } else {
            if (typeof cmd[1] === 'string') {
              cmd[1] = cmd[1].toLowerCase()
            }
            switch (cmd[1]) {
            case 'on':
            case 'true':
              accounts[userInfo.username]['icon'] = true;
              sendServerMessage('Your icon has been turned <span style="color: #55f">on</span>.', socket);
              break;
            case 'off':
            case 'false':
              accounts[userInfo.username]['icon'] = false;
              sendServerMessage('Your icon has been turned <span style="color: #55f">off</span>.', socket);
              break;
            case 'toggle':
              if (accounts[userInfo.username]['icon']) {
                accounts[userInfo.username]['icon'] = false;
                sendServerMessage('Your icon has been toggled <span style="color: #55f">off</span>.', socket);
              } else {
                accounts[userInfo.username]['icon'] = true;
                sendServerMessage('Your icon has been toggled <span style="color: #55f">on</span>.', socket);
              }
              break;
            default:
              sendServerMessage(rhtml('Usage: /icon <on|true|off|false|toggle>'), socket);
              break;
            }
            saveData();
          }
          break;
        case 'verification':
          if (userInfo.rank < 3) {
            sendServerMessage('This command requires the rank <span style="color: #55f">Admin</span>.')
          } else {
            if (typeof cmd[1] === 'string') {
              cmd[1] = cmd[1].toLowerCase()
            }
            switch (cmd[1]) {
            case 'on':
            case 'true':
              spamFilter = true;
              sendServerMessage('Strict verification turned <span style="color: #383">on</span>.', socket);
              break;
            case 'off':
            case 'false':
              spamFilter = false;
              sendServerMessage('Strict verification turned <span style="color: #a55">off</span>.', socket);
              break;
            case 'status':
              if (spamFilter) {
                sendServerMessage('Strict verification turned <span style="color: #383">on</span>.', socket);
              } else {
                sendServerMessage('Strict verification is currently <span style="color: #a55">off</span>.', socket);
              }
              break;
            default:
              sendServerMessage(rhtml('Usage: /verification <on|true|off|false|status>'), socket);
              break;
            }
            saveData();
          }
          break;
        default:
          sendServerMessage('Unknown Command. For a list of commands, use /help.', socket);
          break;
        }
      } else { //Not a command
        if (msc[userInfo.username] === undefined) {
          msc[userInfo.username] = 0
        }
        if (Object.keys(pendingVerification).indexOf(cookie) !== -1) {
          sendServerMessage('Warning: Click "Verify" in order to send messages and not get disconnected!', socket);
          pendingVerification[cookie][2]++;
          if (pendingVerification[cookie][2] > 3) {
            cLog('User ' + cyan(userInfo.username) + ' failed to click verify and still tried to send messages.');
            msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> was automatically disconnected: failed to verify');
            var target = userInfo.username;
            delete pendingVerification[cookie];
            while (online_users[target] !== undefined) {
              removeToken(online_users[target][0], 'f');
            }
            io.emit('u-kick', [target, 'You either used an automated script or did not click "Verify" when requested.']);
          }
        } else if (msg.length / msg.split(' ').length > 38 && userInfo.rank < 3) {
          sendServerMessage('Your message was blocked due to spam.', socket);
          msc[userInfo.username]++;
          setTimeout(function () {
            msc[userInfo.username]--;
          }, 600000);
          msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> attempted to send spam: average word length >38');
          cLog('User ' + cyan(userInfo.username) + ' attemped to spam (Avg. word length >38)');
        } else if (msg.length > 383) { //Limit of input box
          sendServerMessage('Your message was blocked due to spam.', socket);
          msc[userInfo.username]++;
          setTimeout(function () {
            msc[userInfo.username]--;
          }, 600000);
          msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> attempted to send spam: message longer than limit (383 chars)');
          cLog('User ' + cyan(userInfo.username) + ' attemped to spam (Message Length >383 [' + cyan(msg.length) + ' chars])');
        } else if (msg.split(' ').length >= 3 && msg.split(' ')[0] === msg.split(' ')[1] && msg.split(' ')[2] === msg.split(' ')[3] && userInfo.rank < 3) {
          sendServerMessage('Your message was blocked due to spam.', socket);
          msc[userInfo.username]++;
          setTimeout(function () {
            msc[userInfo.username]--;
          }, 600000);
          msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> attempted to send spam: message repeated one word');
          cLog('User ' + cyan(userInfo.username) + ' attemped to spam (Repeated one word)');
        } else if (Date.now() - users_antiSpam['lastMessage'][userInfo.username] < (400 + (msc[userInfo.username] < 40 ? msc[userInfo.username] : 40) * 40)) { //Max 2 second delay
          sendServerMessage('You are sending messages too quickly!', socket);
          if (msc[userInfo.username] >= 10) {
            sendServerMessage('Note: Your message sending rate was decreased due to spamming and will return to normal after several minutes.', socket);
          }
          msc[userInfo.username]++;
          setTimeout(function () {
            msc[userInfo.username]--;
          }, 600000);
          cLog('User ' + cyan(userInfo.username) + ' attemped to send two messages with only a ' + (Date.now() - users_antiSpam['lastMessage'][userInfo.username]) + 'ms delay in between (min ' + (400 + (msc[userInfo.username] < 60 ? msc[userInfo.username] : 60) * 40) + 'ms delay)');
          users_antiSpam['lastMessage'][userInfo.username] = Date.now() + 100;
        } else {
          var u_lm = users_antiSpam['lastMessage'][userInfo.username];
          var u_lfm = users_antiSpam['lastFiveMessages'][userInfo.username];
          if (u_lfm === undefined) {
            u_lfm = []
          }
          u_lfm[u_lfm.length] = Date.now() - u_lm;
          if (u_lfm.length > 5) {
            u_lfm = u_lfm.slice(u_lfm.length - 5, u_lfm.length);
          }
          var u_lts = users_antiSpam['lastTwentySenders'];
          u_lts[u_lts.length] = userInfo.username;
          if (u_lts.length > 20) {
            u_lts = u_lts.slice(u_lts.length - 20, u_lts.length)
          }
          users_antiSpam['lastTwentySenders'] = u_lts;


          var uc = 0;
          for (var i = 0; i < u_lts.length; i++) {
            if (u_lts[i] === userInfo.username) {
              uc++
            }
          }
          var ou = Object.keys(online_users).length;

          users_antiSpam['lastFiveMessages'][userInfo.username] = u_lfm;
          users_antiSpam['lastMessage'][userInfo.username] = Date.now();

          //console.log(users_antiSpam);
          var checkForSpam = (accounts[userInfo.username].noSpamCheck !== true && spamFilter === true);
          if (checkForSpam && u_lfm.length >= 4 && Math.max.apply(null, u_lfm) - Math.min.apply(null, u_lfm) < 50) { //Likely automated message sending: Same/similar delays between each message
            forceVerification(userInfo.prefix + msg, socket, cookie, userInfo.username);
            msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> was marked for suspicious behavior (messages sent w/ same/similar delay)');
          } else if (checkForSpam && Math.round(msg.length * 12 / ((Date.now() - u_lm) / 1000)) > 160) { //Likely automated message sending: WPM higher than 180
            if (lmtc[userInfo.username] === undefined) {
              lmtc[userInfo.username] = 0
            }
            lmtc[userInfo.username]++;
            setTimeout(function () {
              lmtc[userInfo.username]--
            }, 300000);
            if (lmtc[userInfo.username] > 10) {
              if (lmtc[userInfo.username] <= 12) {
                sendServerMessage('Warning: Sending constant pasted/automated messages is not allowed on this server and may get you kicked.', socket);
              }
              if (lmtc[userInfo.username] > 12) {
                sendServerMessage('You are sending too many copy/pasted messages and/or automated messages!', socket);
                forceVerification(userInfo.prefix + msg, socket, cookie, userInfo.username);
                msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> was marked for suspicious behavior (WPM: ' + Math.round(msg.length * 12 / ((Date.now() - u_lm) / 1000) * 10) / 10 + '; Message Length: ' + msg.length + ')');
                if (lmtc[userInfo.username] > 24) {
                  kick(userInfo.username, 'Copy/Paste spam and/or automated messaging');
                }
              }
            }
            if (lmtc[userInfo.username] <= 12) {
              var formatting = userInfo.formatting;
              if (msg.slice(0, 2) === '@@' && formatting) {
                msg = msg.slice(2, msg.length);
                formatting = false
              }
              msg = rhtml(msg, formatting);
              previous_messages[previous_messages.length] = (userInfo.prefix + msg);
              if (previous_messages.length > 200) {
                previous_messages = previous_messages.slice(previous_messages.length - 200, previous_messages.length);
              }
              cLog('User ' + cyan(userInfo.username) + ' sent message ' + cyan(msg));
              io.emit('u-msg', userInfo.prefix + msg);
            }
          } else if (checkForSpam && uc >= (21 - 2 * ou) && uc > 14) { //Likely automated message sending: Majority/All of past twenty messages from that user in specific
            forceVerification(userInfo.prefix + msg, socket, cookie, userInfo.username);
            users_antiSpam['lastTwentySenders'] = u_lts.slice(u_lts.length - 8, u_lts.length); //Lower the count by keeping only the last 9 senders
            msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> was marked for suspicious behavior (most/all of recent messages from sender)');
          } else {
            var formatting = userInfo.formatting;
            if (msg.slice(0, 2) === '@@' && formatting) {
              msg = msg.slice(2, msg.length);
              formatting = false
            }
            msg = rhtml(msg, formatting);
            previous_messages[previous_messages.length] = (userInfo.prefix + msg);
            if (previous_messages.length > 200) {
              previous_messages = previous_messages.slice(previous_messages.length - 200, previous_messages.length);
            }
            cLog('User ' + cyan(userInfo.username) + ' sent message ' + cyan(msg));
            io.emit('u-msg', userInfo.prefix + msg);
          }
        }
      }
    }
  });

  socket.on('s-req-msg', function (token) {
    if (token[1] === 'h') {
      token[1] = cookie
    }
    if (online_users[token[0]] !== undefined) {
      if (online_users[token[0]].indexOf(token[1]) !== undefined) {
        socket.emit('u-prev-msg', previous_messages.join('<br>'));
      }
    }
  });

  socket.on('s-changePswd', function (token) {
    if (token[0] === 'h') {
      token[0] = cookie
    }
    if (online_users[token[1]] !== undefined) {
      if (online_users[token[1]].indexOf(token[0]) !== -1) {
        if (accounts[token[1]] !== undefined) {
          bcrypt.compare(token[2], accounts[token[1]]['password'], function(err, res){
            if (res) {
              if (token[3].length >= 4 && token[3].length <= 255) {
                bcrypt.hash(token[3], 11, function(err, hash) {
                  socket.emit('cp-success');
                  accounts[token[1]]['password'] = hash;
                  saveData();
                  cLog('Changed password for ' + cyan(token[1]) + ' (from IP: ' + cyan(IP) + ')')
                });
              }
            } else {
              socket.emit('err-cpic');
            }
          })
        }
      }
    }
  });

  socket.on('u-verify', function (v) {
    if (v[0][1] === 'h') {
      v[0][1] = cookie
    }
    var userInfo = getUserInfo(v[0]);
    if (pendingVerification[cookie] !== undefined && userInfo) {
      if (pendingVerification[cookie][0] === v[1]) {
        cLog('User ' + cyan(userInfo.username) + ' verified himself/herself.');
        sendServerMessage('Session Verified. You can now send messages.', socket);
        msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> was successfully verified.');
        delete pendingVerification[cookie];
      } else {
        cLog('User ' + cyan(userInfo.username) + ' sent a tampered verification key.');
        var target = userInfo.username;
        while (online_users[target] !== undefined) {
          removeToken(online_users[target][0], 'f');
        }
        io.emit('u-kick', [target, 'A tampered verification key was sent from your account.']);
        msg_admins('User <span style="color: #55a">' + userInfo.name + '</span> sent an invalid verification key.');
      }
    }
  });

  socket.on('s-logout', function () {
    var sid = parseCookies(cookie);
    if(sid !== undefined){
      if(sid.sid !== undefined){
        if(loginKeys[sid.sid] !== undefined){
          delete loginKeys[sid.sid];
        }
      }
    }
    
    delete pendingVerification[cookie];
    removeToken(cookie, 'l');
  });
  socket.on('disconnect', function () {
    delete pendingVerification[cookie];
    removeToken(cookie, 'd');
  });
});

http.listen(8091, function () {
  cLog(gray('Chat server now active!'));
  cLog('Now listening on localhost:8091');
});

/*}
catch(err){
cLog("Chatterbox ran into a critical error and stopped. Error: "+err);
var app = require('express')();
var http = require('http').Server(app);
app.get("/",function(req,res){
	res.sendFile(__dirname+'/error.html');
});
http.listen(8091, function(){
  cLog('(Error page is now active)');
});
}*/
