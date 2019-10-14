function split_reverse(str, segcount, seglen){
    const len = str.length;
    const suffixlen = segcount * seglen;
    const prefixlen = len - suffixlen;

    if(prefixlen < 0){
        return str; // FIXME: Copy?
    }else{
        const prefix = str.substring(0, prefixlen);
        let suffix = str.substring(prefixlen);
        let acc = prefix; 
        while(suffix != ""){
            let part = suffix.substring(0, seglen);
            suffix = suffix.substring(seglen);
            if(acc != ""){
                acc = acc + "/" + part;
            }else{
                acc = part;
            }
        }
        return acc;
    }
}

function split_reverse_min(str, minlen, segcount, seglen){
    return split_reverse(str.padStart(minlen, "0"), segcount, seglen);
}

module.exports = {
    split_reverse:split_reverse,
    split_reverse_min:split_reverse_min
}
