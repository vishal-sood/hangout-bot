const https = require('https');
const http = require('http');
var CronJobManager = require('cron-job-manager');

const loginUserMap = require('./git-uid-name-map.json');

let chatMemberMap = {};
function processMemberships(membershipList) {
    // {
    //     "name": string,
    //     "member": {
    //         "displayName": string,
    //     }
    // }
    
    membershipList.forEach(membership => {
        chatMemberMap[membership.member.displayName] = membership.name;
    });
}

function getCronString(startMin, intervalInMin = 30) {
    let minStr = `${startMin}`;
    
    while(60 % intervalInMin !== 0) {
        intervalInMin++;
    }
    
    let minVal = startMin;
    while ((minVal = (minVal + intervalInMin) % 60) !== startMin) {
        minStr += `,${minVal}`;
    }
    
    return `0,15,30,45 ${minStr} * * * *`;
}

function getReminderMessageFunction(prUrl, userId = 'all') {
    return () => {
        console.log('triggered');
        var postData = JSON.stringify({
            text: `Hi <users/${userId}>! Your review has been requested on ${prUrl}`
        });
        
        var options = {
            hostname: 'chat.googleapis.com',
            path: '', // chatroom URL here
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' }
        };
        
        var req = https.request(options, (res) => {
            console.log('statusCode:', res.statusCode);
            console.log('headers:', res.headers);
            
            res.on('data', (d) => {
                process.stdout.write(d);
            });
        });
        
        req.on('error', (e) => {
            console.error(e);
        });
        
        req.write(postData);
        req.end();
    };
}

// const google = require('googleapis').google;
// const privatekey = require("./pr-reminder-bot-c0fa583c879e.json");

// NOTE: this function is not working completely as of now
function getMembersList() {
    var options = {
        hostname: 'chat.googleapis.com',
        path: '', // chatroom URL here
        method: 'GET'
    };
    
    var req = https.request(options, (res) => {
        console.log('statusCode:', res.statusCode);
        console.log('headers:', res.headers);
    
        let body = '';
        res.on('data', chunk => {
            body += chunk.toString();
        });
    
        res.on('end', () => {
            body = JSON.parse(body);
            processMemberships(body.memberships);
        });
    });
    
    req.on('error', (e) => {
        console.error(e);
    });
    req.end();
    
    // let jwtClient = new google.auth.JWT(
    //     privatekey.client_email,
    //     null,
    //     privatekey.private_key,
    //     [ 'https://www.googleapis.com/auth/chat' ]
    // );
    // //authenticate request
    // jwtClient.authorize(function (err) {
    //     if (err) {
    //         console.log(err);
    //         return;
    //     } else {
    //         console.log("Successfully connected!");
    //     }
    // });

    // let chat = google.chat('v1');
    // chat.spaces.members.list({
    //     auth: jwtClient,
    //     parent: 'spaces/AAAAVwKc-Ig',
    // }, function (err, response) {
    // if (err) {
    //     console.log('The API returned an error: ' + err);
    // } else {
    //     console.log(response);
    // }
    // });
}
getMembersList();

const manager = new CronJobManager();
const app = http.createServer((req, res) => {
    if (req.method === 'POST') {
        let body = '', postData;
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            postData = JSON.parse(body);
            if (req.url === '/pr-reminder-hook') {                
                let reviewRequestKey;
                // PR review requested
                if (postData.action === 'review_requested') {
                    reviewRequestKey = `${postData['pull_request']['number']}#${postData['requested_reviewer']['login']}`;
                    
                    const currTime = Date.now();
                    const currMin = Math.floor(currTime / 60000) % 60;
                    
                    const cronString = getCronString(currMin, 1);
                    
                    manager.add(reviewRequestKey, cronString, getReminderMessageFunction(postData['pull_request']['html_url'], chatMemberMap[loginUserMap[postData['requested_reviewer']['login']].fullName]));
                    manager.start(reviewRequestKey);
                }
                
                // PR review request dimissed
                if (postData.action === 'review_request_removed') {
                    reviewRequestKey = `${postData['pull_request']['number']}#${postData['requested_reviewer']['login']}`;
                    
                    if (manager.exists(reviewRequestKey)) {
                        manager.deleteJob(reviewRequestKey);
                    }
                }
                
                // PR review submitted
                if (postData.action === 'submitted') {
                    reviewRequestKey = `${postData['pull_request']['number']}#${postData['review']['user']['login']}`;
                    
                    if (manager.exists(reviewRequestKey)) {
                        manager.deleteJob(reviewRequestKey);
                    }
                }
            }
        });
    }
    
    res.writeHead(200);
    res.end();
});

app.listen(3000)
