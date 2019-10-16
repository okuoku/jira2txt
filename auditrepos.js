const fs = require("fs");
const path = require("path");
const Yaml = require("js-yaml");
const Rspath = require("./rspathutils.js");
const Queue = require("promise-queue");

const RecursiveReaddir = require("recursive-readdir");

const rootconfig = Yaml.safeLoad(fs.readFileSync(__dirname + "/config.yaml", "utf8"));

const ROOT = rootconfig.repository.path + "/issues";

async function calc_filelist(){
    return await RecursiveReaddir(ROOT).then(files => {
        return Promise.resolve(files.filter(e => path.extname(e) == ".yaml"));
    });
}

async function run(){
    const files = await calc_filelist();
    //console.log(files);
    files.forEach(e => {
        const obj = Yaml.safeLoad(fs.readFileSync(e, "utf8"));
        const key = obj.key;
        if(obj.changelog){
            if(obj.changelog.maxResults != obj.changelog.total){
                console.log("Truncated result",key,e);
            }
            if(obj.changelog.startAt != 0){
                console.log("Something wrong",key,e);
            }
        }else{
            console.log("WARN: no changelog", key);
        }
        if(obj.fields.comment){
            if(obj.fields.comment.maxResults != obj.fields.comment.total){
                console.log("Truncated result",key,e);
            }
            if(obj.fields.comment.startAt != 0){
                console.log("Something wrong",key,e);
            }
        }else{
            console.log("WARN: no comment", key);
        }
    });
}

run();
