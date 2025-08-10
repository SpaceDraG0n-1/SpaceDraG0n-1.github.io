var posts=["posts/16109.html","posts/16111.html","posts/16110.html","posts/16108.html"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };