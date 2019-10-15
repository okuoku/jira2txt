// Set env:
//   JIRAFETCH_SESSION to JSESSIONID of JIRA cookie (UNIMPL)
//   JIRAFETCH_USER 
//   JIRAFETCH_PASSWORD

require("date-utils");
const url = require("url");
const fs = require("fs");
const Yaml = require("js-yaml");
const Fetch = require("node-fetch");
const Rspath = require("./rspathutils.js");
const Mkdirp = require("mkdirp");
const Queue = require("promise-queue");
const util = require("util");
const exec = util.promisify(require("child_process").exec);


let JIRAUSER = process.env.JIRAFETCH_USER;
let JIRAPASSWORD = process.env.JIRAFETCH_PASSWORD;
//let JSESSIONID = process.env.JIRAFETCH_SESSION;

const rootconfig = Yaml.safeLoad(fs.readFileSync(__dirname + "/config.yaml", "utf8"));
const config = Yaml.safeLoad(fs.readFileSync(rootconfig.repository.path + "/jirafetch-config.yaml", "utf8"));

const jira_urlobj = url.parse(config.jira.root);
const jira_protocol = jira_urlobj.protocol;
const jira_host = jira_urlobj.host;
const jira_pathname = jira_urlobj.pathname;
const jira_jql = config.jira.jql;

function fetch_jira(endpoint, query){
    const auth = "Basic " + Buffer.from(JIRAUSER + ":" + JIRAPASSWORD)
        .toString("base64");
    const uri = url.format({ protocol: jira_protocol,
                           host: jira_host,
                           pathname: jira_pathname + endpoint,
                           query: query});
    //console.log("Session", JSESSIONID);
    console.log("JIRA:", uri);

    return Fetch(uri, {
        method: "GET",
        headers: {
            "Authorization": auth
            //"Cookie" : ("JSESSIONID=" + JSESSIONID)
        }})
        .then(res => {
            if(res.ok){
                return res.json();
            }else{
                return Promise.resolve(false);
            }
        });
}

function load_issue_yaml(id){
    const dir = rootconfig.repository.path + "/issues/" + 
        Rspath.split_reverse_min(id, 8, 4, 2);
    const file = dir + "/issue.yaml";
    if(fs.existsSync(file)){
        return Yaml.safeLoad(fs.readFileSync(file, "utf8"));
    }else{
        return false;
    }
}

function save_issue_yaml(obj){
    const dir = rootconfig.repository.path + "/issues/" + 
        Rspath.split_reverse_min(obj.id, 8, 4,2);
    const file = dir + "/issue.yaml";
    Mkdirp.sync(dir);
    fs.writeFileSync(file, Yaml.safeDump(obj, {sortKeys: true}), "utf8");
    console.log("Write", file);
}

async function fetch_jira_search(query){
    const res = await fetch_jira("/rest/api/2/search", query);
    //console.log(res);
    return res;
}

async function fetch_jira_issue(issueid /* String */){
    const res = await fetch_jira("/rest/api/2/issue/" + issueid, {});
    //console.log(res);
    return res;
}

async function fetch_jira_search_after(query, date, refobj){
    let refid = "";
    if(refobj){
        refid = " and (id > " + refobj.id + ")";
    }
    const jql = 
        "(" + query + ")" + "and updated > \"" + date + "\"" + refid +
        " ORDER BY ID ASC";

    const res = await fetch_jira_search({fields: "updated", jql: jql, maxResults: 1000});
    return res;
}

async function fetch_total(query, date){ // => [{id, updated}]
    let refobj = false;
    let acc = [];
    let obj = {};

    for(;;){
        let res = await fetch_jira_search_after(query, date,refobj);
        if(! res){
            console.log("ERRAT: ", refobj);
            return false;
        }
        if(res.issues.length == 0){
            return acc;
        }
        for(;;){
            refobj = res.issues[0];
            res.issues.shift();
            obj = {id: refobj.id, updated: refobj.fields.updated};
            //console.log("To fetch:", obj);
            acc.push(obj);
            if(res.issues.length == 0){
                break;
            }
        }
    }
}

async function run(jiradate){ // => Update count
    const issues = await fetch_total(jira_jql, jiradate);
    const Q = new Queue(8, Infinity);
    let buf = [];
    let cur = [];
    let works = [];

    //console.log(issues);
    if(! issues){
        console.log("ERR");
        return false;
    }

    const beforelen = issues.length;
    const to_fetch = issues.filter(e => {
        const prev = load_issue_yaml(e.id);
        if(prev){
            // It seems JIRA sometimes quantize result with seconds...
            // Reduce precision before comparison
            const prevdate = new Date(prev.fields.updated);
            const todate = new Date(e.updated);

            const diff = prevdate.getTime() - todate.getTime();

            if(Math.abs(diff) < 1000){
                //console.log("Reject", diff, e);
                return false;
            }else{
                console.log("Do fetch", prev.fields.updated, e.updated);
            }
        }else{
            console.log("New", e.id);
        }
        return true;
    });

    const afterlen = to_fetch.length;

    to_fetch.forEach(e => {
        works.push(new Promise(res => {
            Q.add(async function (){
                const issue = await fetch_jira_issue(e.id);
                if(! issue.id){
                    console.log("Wrong", issue);
                    process.abort();
                }
                buf.push(issue);
                res(true);
            });
        }));
    });

    await Promise.all(works).then(_ => {
        buf.forEach(e => {
            console.log("Write", e.id);
            save_issue_yaml(e);
        });
        console.log("Done", beforelen, afterlen);
    });

    return afterlen;
}

async function delay(){
    return new Promise(res => {
        console.log("Sleep...");
        setTimeout(_ => res(), 1000 * 15);
    });
}

async function loop(){
    let prevtime = false;
    let updates = 0;
    for(;;){
        let checktime = new Date;
        checktime.add({"seconds": -120});
        console.log("Check", checktime.toFormat("YYYY-MM-DD HH24:MI"));
        updates = await run(prevtime ? prevtime.toFormat("YYYY-MM-DD HH24:MI") :
        "1999-01-01");
        prevtime = checktime;
        await delay(); // FIXME: Do we need to ensure close?
        if(updates > 0){
            try {
                await exec("git add issues", // FIXME: Configurable??
                           {cwd: rootconfig.repository.path});
                const {stdout, stderr} = 
                    await exec("git commit -q -m Update",
                               {cwd: rootconfig.repository.path});
                console.log("Stdout", stdout);
                console.log("Stderr", stderr);
            } catch(e) {
                console.log("Ignore script error.",e);
            }
        }
    }
}

loop();
