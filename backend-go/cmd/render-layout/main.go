package main

import (
	"flag"
	"fmt"
	"os"

	"deskbook/backend-go/internal/exporter"
)

func main() {
	htmlOut := flag.Bool("html", false, "render standalone HTML instead of raw SVG")
	title := flag.String("title", "Office Layout", "HTML title")
	flag.Parse()

	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: render-layout [-html] [-title title] layout.json")
		os.Exit(2)
	}

	raw, err := os.ReadFile(flag.Arg(0))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	layout, err := exporter.ParseLayoutJSON(raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	svg, err := exporter.RenderSVG(layout)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *htmlOut {
		fmt.Print(exporter.RenderHTML(svg, *title))
		return
	}
	fmt.Print(svg)
}
