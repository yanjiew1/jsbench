QJS ?= qjs
PYTHON ?= python3
ARGS ?=

.PHONY: bench list smoke combined bench-combined clean
bench:
	$(QJS) --std jetstream/run.js $(ARGS)
list:
	$(QJS) --std jetstream/run.js --list
smoke:
	$(QJS) --std jetstream/run.js --iterations 1 $(ARGS)
combined:
	$(PYTHON) tools/build-combined.py
bench-combined: combined
	$(QJS) -d build/jetstream.js $(ARGS)
clean:
	rm -rf build

.PHONY: check
check:
	QJS="$(QJS)" $(PYTHON) -m unittest discover -s tests -v
