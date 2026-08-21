using System;
using System.IO;
using System.Windows;
using EstudioGuitarra.Audio;
using EstudioGuitarra.Interop;

namespace EstudioGuitarra;

public partial class MainWindow : Window
{
    private AudioEngine? _engine;
    private AudioBridge? _bridge;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await Web.EnsureCoreWebView2Async();

        _engine = new AudioEngine();
        _bridge = new AudioBridge(_engine);

        // Expone el motor de audio a JS como window.chrome.webview.hostObjects.audio
        Web.CoreWebView2.AddHostObjectToScript("audio", _bridge);

        // Sirve wwwroot/ como https://estudio.local/ para poder usar rutas relativas,
        // fetch, módulos, etc. sin las restricciones de file://
        var wwwroot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
            "estudio.local", wwwroot, Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

        Web.CoreWebView2.Navigate("https://estudio.local/index.html");
    }

    private void MainWindow_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        _engine?.Dispose();
    }
}
