
var cheerio = require('cheerio');
var denodeify = require('denodeify');
var request = denodeify(require('request'));

var mailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');

//var AdmZip = require('adm-zip');
//var NodeZip = new require('node-zip');

var walkLeafReduce = function (root, fn, val) {
	(function _dfs(root, depth) {
		if (root.children && root.children.length) {
			root.children.forEach(function (child) {
				_dfs(child, depth+1);
			});
		} else {
			val = fn(root, val);
		}
	})(root, 0);
	return val;
};

var walkNonLeafReduce = function (root, fn, val) {
	(function _dfs(root, depth) {
		if (root.children && root.children.length) {
			val = fn(root, val);
			root.children.forEach(function (child) {
				_dfs(child, depth+1);
			});
		}
	})(root, 0);
	return val;
};

var removeEmptyNodes = function ($, root) {
	function dfs(root, depth) {
		var n = 0;

		(function _dfs(root, depth) {
			if (root.children && root.children.length) {
				root.children.forEach(function (child) {
					_dfs(child, depth+1);
				});
			} else {
				if (root.name == 'img')
					return;
				if (root.data == null || root.data.trim() == '') {
					$(root).remove();
					n++;
				}
			}
		})(root, depth);

		return n;
	};

	while (dfs(root) != 0);
};

var filterMainDom = function ($) {
	$('style').remove();
	$('script').remove();
	$('head').remove();
	$('link').remove();
	$('body').html($('#js_content'));
	$('[style]').each(function () {
		$(this).removeAttr('style');
	});

	var root = $('body')[0];
	// parent,children=[],name=div,type=tag/text,data="",attribs={class,id}
	
	$('a').each(function () {
		$(this).remove();
	});
	//$('img').remove();

	walkNonLeafReduce(root, function (node, val) {
		if (node.children.length == 1 && node.children[0].name == 'br')
			return val.concat([node]);
		return val;
	}, []).forEach(function (node) {
		$(node).remove();
	});
};

var keywordsRegex = new RegExp([
	'优质', '推荐', '阅读原文', '惊喜', 'ID', '识别', '长按', '关注', '欢迎', '复制', '微信',
	'分享', '评论', '订阅', '回复', '查看', '点击', '热门', '扫码', '精品', '下方', '二维码', 
	'粘贴', '搜索', '添加', '精选', '公众号', '链接', '淘宝', '微博', '转发', '购买', '地址',
	'榜单', '版权', '声明', '作者', '转载', '邮箱', '联系', '点赞', '联系', '侵权', '原创',
	'下载', '红包', '内容', 
	'http://', 'https://',
].join('|'), 'g');

var removeCommonDom = function ($1, $2) {
	var getTextNodes = function ($) {
		return walkLeafReduce($('body')[0], function (node, val) {
			if (node.type == 'text')
				return val.concat([{type: 'text', node: node, text: node.data}]);
			else if (node.name == 'img')
				return val.concat([{type: 'img', node: node, text: node.attribs['data-src']}]);
			return val;
		}, []);
	};

	var textNodes1 = getTextNodes($1);
	var textNodes2 = getTextNodes($2);
	var nr = Math.min(textNodes1.length, textNodes2.length);

	var existedImgs = {};

	textNodes2.forEach(function (n) {
		if (n.type == 'img')
			existedImgs[n.text] = true;
	});

	textNodes1.forEach(function (n) {
		if (n.type == 'img' && existedImgs[n.text])
			n.remove = true;
	});

	textNodes1.forEach(function (n) {
		if (n.remove || n.type == 'img') {
			n.keywordCount = 0;
			return;
		}
		n.keywordCount = (n.text.match(keywordsRegex) || []).length;
	});

	var cmpTextNode = function (n1, n2) {
		if (n1.remove)
			return;
		if (n1.text.trim() == '')
			return;
		if (n1.text == n2.text) {
			n1.remove = true;
			return;
		}
	};
	for (var i = 0; i < nr; i++) {
		cmpTextNode(textNodes1[i], textNodes2[i]);
		cmpTextNode(textNodes1[textNodes1.length-1-i], textNodes2[textNodes2.length-1-i]);
	}

	!function () {
		var total = {keyword: 0, length: 0, segment: 0};
		for (var i = textNodes1.length-1; i >= 0; i--) {
			var n = textNodes1[i];
			if (!n.remove && n.type == 'text') {
				total.length += n.text.length;
				total.keyword += n.keywordCount;
				total.segment++;
				var score = total.keyword;
				console.log(n.type, n.keywordCount, n.text.length, total.keyword, total.length, total.segment, 
										total.keyword/total.segment,
										n.text);
			}
			//console.log(n.type =='text' && (n.keywordCount / n.text.length), n.text, n.text.length);
		}
	};

	textNodes1.forEach(function (n) {
		if (n.remove)
			$1(n.node).remove();
	});

	removeEmptyNodes($1, $1('body')[0]);
};

var fetchImages = function ($) {
	var prefix = 'out1-';
	return Promise.all($('img').map(function (i) {
		var img = this;
		var url = img.attribs['data-src'];
		return request({
			url: url,
			encoding: null,
		}).then(function (res) {
			var body = res.body.toString('base64');
			var type = res.headers['content-type'];
			img.attribs.src = 'data:'+type+';base64,'+body;
			//img.attribs.src = filename;
			//var filename = prefix+i+'.'+img.attribs['data-type'];
			//return {buf: res.body, filename: filename};
		});
	}).get());
};

// {html, htmlForDiff} => {html: html}
var convertArticle = function (opts) {
	var $1 = cheerio.load(opts.html);
	filterMainDom($1);

	if (opts.htmlForDiff) {
		var $2 = cheerio.load(opts.htmlForDiff);
		filterMainDom($2);
		removeCommonDom($1, $2);
	}

	//zipBuf: zip.toBuffer(),
	//zipBuf: zipBuf,
	//var zip = new AdmZip();
	//var zip = new NodeZip();
	/*
		 zip.file('index.html', html);
		 imgs.forEach(function (img) {
		 zip.file(img.filename, img.buf);
		 });
		 var zipBuf = zip.generate({base64:false,compression:'DEFLATE'});
		 */
	return fetchImages($1).then(function (imgs) {
		console.log('fetchImages', imgs.length);
		var html = $1('body').html();
		return {
			html: html,
		};
	});
};

var combineArticles = function (opts) {
	return Promise.all(opts.articles.map(function (article) {
		return convertArticle(article).then(function (res) {
			return res.html + '<br style="page-break-after:always">';
		});
	})).then(function (res) {
		var html = '<html><head></head><body>';
		html += res.join('');
		html += '</body></html>';
		return {html: html};
	});
};

var sendArticles = function (opts) {
	return combineArticles({articles: opts.articles}).then(function (res) {
		var transporter = mailer.createTransport();
		return denodeify(transporter.sendMail.bind(transporter))({
			from: 'heykindle@herecake.cc',
			to: opts.email,
			subject: 'hello',
			text: 'hello world!',
			attachments: [{
				filename: 'index.html',
				contentType: 'text/html',
				content: res.html,
			}],
		}).then(function () {
			return {size: res.html.length};
		});
	});
};

module.exports.sendArticles = sendArticles;

