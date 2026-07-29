using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class PortableLauncher
{
    private const string RuntimeDirectoryName = "runtime";
    private const string ApplicationFileName = "Media Photo Workbench.exe";

    [STAThread]
    private static void Main(string[] args)
    {
        string launcherDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string runtimeDirectory = Path.Combine(launcherDirectory, RuntimeDirectoryName);
        string applicationPath = Path.Combine(runtimeDirectory, ApplicationFileName);

        if (!File.Exists(applicationPath))
        {
            MessageBox.Show(
                "应用运行环境不完整。请重新解压整个 ZIP，保留 runtime 文件夹及其中全部文件。",
                "融媒体图片工作台",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        try
        {
            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = applicationPath,
                WorkingDirectory = runtimeDirectory,
                UseShellExecute = false,
                Arguments = JoinArguments(args)
            };

            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "无法启动融媒体图片工作台。\r\n\r\n" + error.Message,
                "融媒体图片工作台",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static string JoinArguments(string[] args)
    {
        StringBuilder result = new StringBuilder();
        foreach (string argument in args)
        {
            if (result.Length > 0)
            {
                result.Append(' ');
            }

            result.Append(QuoteArgument(argument));
        }

        return result.ToString();
    }

    private static string QuoteArgument(string argument)
    {
        if (argument.Length > 0 &&
            argument.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
        {
            return argument;
        }

        StringBuilder result = new StringBuilder();
        result.Append('"');
        int backslashes = 0;

        foreach (char character in argument)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }

            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }

            result.Append('\\', backslashes);
            backslashes = 0;
            result.Append(character);
        }

        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}
