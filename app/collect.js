/* Replaces AgentChrome.mount with a collector so the existing prototypes register their create() functions
 * as views. app.js restores the real mount and mounts ONE shell containing them all. */
(function (g) {
  var real = g.AgentChrome.mount; var views = [];
  g.__AppViews = { views: views, realMount: real };
  g.AgentChrome.mount = function (cfg) { views.push(cfg); };
})(window);
